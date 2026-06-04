import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer-core';
import type { RenderRunner } from './exportJob.js';

export function totalFrames({
  sequenceLength,
  slideMs,
  fps,
}: {
  sequenceLength: number;
  slideMs: number;
  fps: number;
}): number {
  if (sequenceLength <= 0) return 0;
  return Math.round((sequenceLength * slideMs) / 1000 * fps);
}

export function buildFfmpegArgs({
  fps,
  output,
}: {
  fps: number;
  output: string;
}): string[] {
  // Real-time screencast frames arrive at a variable rate (Chromium emits one per
  // composited change). -use_wallclock_as_timestamps stamps each by arrival time
  // and the fps filter resamples to a constant <fps>, so output timing matches the
  // real show and a slow host just duplicates frames instead of hanging.
  return [
    '-y',
    '-f', 'image2pipe',
    '-use_wallclock_as_timestamps', '1',
    '-i', '-',
    '-vf', `fps=${fps}`,
    '-c:v', 'libx264',
    '-preset', 'veryfast',
    '-pix_fmt', 'yuv420p',
    '-crf', '20',
    '-an',
    output,
  ];
}

const WIDTH = 1920;
const HEIGHT = 1080;
const DONE_POLL_MS = 250;
const SAFETY_SLACK_MS = 15_000; // stop a bit past the expected end if __mosaicDone never flips

function timestamp(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

// Plays the real slideshow in `?render=1` in real time and records it with
// Chromium's screencast (Page.startScreencast): Chromium streams composited JPEG
// frames as the show plays, and ffmpeg stamps them by arrival time and resamples
// to a constant fps. This replaced virtual-time stepping, which progressively
// wedged Page.captureScreenshot mid-render and failed the export (see the
// v0.9.4 spec). Real-time capture degrades gracefully on a slow host (fewer
// unique frames, duplicated to hold the rate) instead of hanging.
export const renderVideo: RenderRunner = async ({ renderUrl, outDir, eventId }, onProgress) => {
  const exportsDir = path.join(outDir, 'exports');
  fs.mkdirSync(exportsDir, { recursive: true });
  const filename = `${eventId}-${timestamp(new Date())}.mp4`;
  const output = path.join(exportsDir, filename);

  const browser = await puppeteer.launch({
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH ?? '/usr/bin/chromium',
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-dev-shm-usage',
      '--hide-scrollbars',
      '--force-color-profile=srgb',
    ],
  });

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: WIDTH, height: HEIGHT, deviceScaleFactor: 1 });

    await page.goto(`${renderUrl}/?render=1`, { waitUntil: 'load' });
    await page.waitForFunction('!!window.__mosaicRender', { timeout: 15000 });

    const meta = (await page.evaluate('window.__mosaicRender')) as {
      fps: number;
      sequenceLength: number;
      slideMs: number;
    };
    const total = totalFrames(meta);
    if (total === 0) throw new Error('nothing to export — this event has no photos yet');
    const expectedMs = meta.slideMs * meta.sequenceLength;

    const ff = spawn('ffmpeg', buildFfmpegArgs({ fps: meta.fps, output }), {
      stdio: ['pipe', 'inherit', 'inherit'],
    });
    const ffDone = new Promise<void>((resolve, reject) => {
      ff.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg exited with code ${code}`))));
      ff.on('error', reject);
    });

    const client = await page.target().createCDPSession();
    // Pipe each composited frame to ffmpeg; ack only after backpressure clears so
    // Chromium self-throttles and buffered frames stay bounded. CDP delivers
    // frames in order and each write enqueues atomically, so the byte stream stays
    // ordered even though handlers may overlap at the await.
    client.on('Page.screencastFrame', async (e) => {
      if (!ff.stdin.write(Buffer.from(e.data, 'base64'))) {
        await new Promise((r) => ff.stdin.once('drain', r));
      }
      try {
        await client.send('Page.screencastFrameAck', { sessionId: e.sessionId });
      } catch {
        // session is tearing down after the show ends; the frame is already written
      }
    });
    await client.send('Page.startScreencast', { format: 'jpeg', quality: 90, everyNthFrame: 1 });

    const start = Date.now();
    while (!(await page.evaluate('window.__mosaicDone'))) {
      if (Date.now() - start > expectedMs + SAFETY_SLACK_MS) break;
      onProgress(Math.min(total, Math.round(((Date.now() - start) / 1000) * meta.fps)), total);
      await new Promise((r) => setTimeout(r, DONE_POLL_MS));
    }

    await client.send('Page.stopScreencast');
    onProgress(total, total);
    ff.stdin.end();
    await ffDone;
    return { outputUrl: `/data/exports/${filename}` };
  } finally {
    await browser.close();
  }
};
