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
  width,
  height,
  fps,
  output,
}: {
  width: number;
  height: number;
  fps: number;
  output: string;
}): string[] {
  return [
    '-y',
    '-f', 'image2pipe',
    '-framerate', String(fps),
    '-i', '-',
    '-vf', `scale=${width}:${height}:flags=lanczos`,
    '-c:v', 'libx264',
    '-pix_fmt', 'yuv420p',
    '-crf', '20',
    '-r', String(fps),
    '-an',
    output,
  ];
}

const WIDTH = 1920;
const HEIGHT = 1080;
const FRAME_CAP_SLACK_SECONDS = 2; // hard stop a couple seconds past the expected end

function timestamp(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

// Loads the real slideshow in `?render=1`, steps the page's virtual clock one
// frame at a time, screenshots each frame, and pipes them to ffmpeg. Virtual
// time decouples capture from wall-clock, so frames are deterministic and a slow
// host cannot drop them.
export const renderVideo: RenderRunner = async ({ renderUrl, outDir, eventId }, onProgress) => {
  const exportsDir = path.join(outDir, 'exports');
  fs.mkdirSync(exportsDir, { recursive: true });
  const filename = `${eventId}-${timestamp(new Date())}.mp4`;
  const output = path.join(exportsDir, filename);

  const log = (msg: string) => console.error(`[export ${eventId}] +${Date.now() - t0}ms ${msg}`);
  const t0 = Date.now();
  log('launching chromium');
  const browser = await puppeteer.launch({
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH ?? '/usr/bin/chromium',
    headless: true,
    // Pipe Chromium's own stdout/stderr to the API logs so a compositor/GPU
    // stall surfaces in `docker logs` instead of only as a CDP timeout.
    dumpio: true,
    args: [
      '--no-sandbox',
      '--disable-dev-shm-usage',
      '--hide-scrollbars',
      '--force-color-profile=srgb',
    ],
  });
  log(`launched ${await browser.version()}`);

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: WIDTH, height: HEIGHT, deviceScaleFactor: 1 });
    const client = await page.target().createCDPSession();

    // Load the page in real time first (a small, bounded amount of wall-clock),
    // then drive the capture with virtual time below. Setting a virtual-time
    // budget before navigation can exhaust mid-load and stall the page so the
    // load never completes, so we keep load and capture separate.
    log('navigating');
    await page.goto(`${renderUrl}/?render=1`, { waitUntil: 'load' });
    log('loaded; waiting for __mosaicRender');
    await page.waitForFunction('!!window.__mosaicRender', { timeout: 15000 });

    const meta = (await page.evaluate('window.__mosaicRender')) as {
      fps: number;
      sequenceLength: number;
      slideMs: number;
    };
    log(`meta ${JSON.stringify(meta)}`);
    const total = totalFrames(meta);
    if (total === 0) throw new Error('nothing to export — this event has no photos yet');
    const frameCap = total + meta.fps * FRAME_CAP_SLACK_SECONDS;
    const budgetMs = 1000 / meta.fps;

    // Freeze the page clock before the first capture so frame 0 is captured
    // deterministically at virtual t=0; the loop then steps the clock per frame.
    await client.send('Emulation.setVirtualTimePolicy', { policy: 'pause' });
    log('virtual time paused; taking first screenshot');

    const ff = spawn('ffmpeg', buildFfmpegArgs({ width: WIDTH, height: HEIGHT, fps: meta.fps, output }), {
      stdio: ['pipe', 'inherit', 'inherit'],
    });
    const ffDone = new Promise<void>((resolve, reject) => {
      ff.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg exited with code ${code}`))));
      ff.on('error', reject);
    });

    let frame = 0;
    let done = false;
    while (!done && frame < frameCap) {
      const shot = await page.screenshot({ type: 'png' });
      if (frame === 0) log('first screenshot OK');
      if (!ff.stdin.write(shot)) {
        await new Promise((r) => ff.stdin.once('drain', r));
      }
      frame += 1;
      onProgress(frame, total);

      const expired = new Promise<void>((resolve) => {
        client.once('Emulation.virtualTimeBudgetExpired', () => resolve());
      });
      await client.send('Emulation.setVirtualTimePolicy', { policy: 'advance', budget: budgetMs });
      await expired;
      done = Boolean(await page.evaluate('window.__mosaicDone'));
    }

    ff.stdin.end();
    await ffDone;
    return { outputUrl: `/data/exports/${filename}` };
  } finally {
    await browser.close();
  }
};
