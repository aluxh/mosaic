import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer-core';
import type { RenderRunner } from './exportJob.js';

const CHROME_CANDIDATES = [
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/snap/bin/chromium',
];

function findChromium(): string {
  const fromEnv = process.env.PUPPETEER_EXECUTABLE_PATH;
  if (fromEnv) return fromEnv;
  const found = CHROME_CANDIDATES.find((p) => fs.existsSync(p));
  if (found) return found;
  throw new Error(
    `No Chrome/Chromium found. Set PUPPETEER_EXECUTABLE_PATH to your browser binary.\n` +
    `Tried: ${CHROME_CANDIDATES.join(', ')}`,
  );
}

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

// Build an ffconcat manifest from an array of {file, tsMs} entries.
// Each entry gets a `duration` of (next.tsMs - cur.tsMs) / 1000; the last
// entry gets no duration (ffmpeg uses stream duration as fallback).
export function buildConcatManifest(frames: { file: string; tsMs: number }[]): string {
  const lines = ['ffconcat version 1.0'];
  for (let i = 0; i < frames.length; i++) {
    lines.push(`file '${frames[i]!.file}'`);
    if (i + 1 < frames.length) {
      const dur = (frames[i + 1]!.tsMs - frames[i]!.tsMs) / 1000;
      lines.push(`duration ${dur.toFixed(6)}`);
    }
  }
  return lines.join('\n') + '\n';
}

// Hi-fi two-phase capture for capable machines (export-local CLI).
// Phase 1: screencast frames to a temp dir with no ffmpeg running (Chromium gets
// full CPU → more unique frames). Phase 2: encode with setpts to restore real-time
// speed and resample to the target fps. Cleans up the temp dir on success.
export async function renderVideoHiFi(
  {
    renderUrl,
    outDir,
    eventId,
    slow = 1,
    fps = 30,
    slideMs: slideMsOverride,
  }: { renderUrl: string; outDir: string; eventId: string; slow?: number; fps?: number; slideMs?: number },
  onProgress: (framesDone: number, totalFrames: number) => void,
): Promise<{ outputUrl: string }> {
  const exportsDir = path.join(outDir, 'exports');
  fs.mkdirSync(exportsDir, { recursive: true });
  const filename = `${eventId}-${timestamp(new Date())}.mp4`;
  const output = path.join(exportsDir, filename);
  const framesDir = path.join(exportsDir, `.frames-${Date.now()}`);
  fs.mkdirSync(framesDir, { recursive: true });

  const browser = await puppeteer.launch({
    executablePath: findChromium(),
    headless: true,
    args: CHROMIUM_ARGS,
  });

  const frames: { file: string; tsMs: number }[] = [];

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: WIDTH, height: HEIGHT, deviceScaleFactor: 1 });
    const renderParams = new URLSearchParams({ render: '1', slow: String(slow) });
    if (slideMsOverride) renderParams.set('slideMs', String(slideMsOverride));
    await page.goto(`${renderUrl}/?${renderParams}`, { waitUntil: 'load' });
    await page.waitForFunction('!!window.__mosaicRender', { timeout: 15000 });

    const meta = (await page.evaluate('window.__mosaicRender')) as {
      fps: number; sequenceLength: number; slideMs: number;
    };
    const total = totalFrames(meta);
    if (total === 0) throw new Error('nothing to export — this event has no photos yet');
    const expectedMs = meta.slideMs * meta.sequenceLength * slow;

    // Phase 1: capture — no ffmpeg, Chromium gets full CPU.
    const client = await page.target().createCDPSession();
    let frameIdx = 0;
    client.on('Page.screencastFrame', async (e) => {
      const file = path.join(framesDir, `f-${String(frameIdx).padStart(8, '0')}.jpg`);
      fs.writeFileSync(file, Buffer.from(e.data, 'base64'));
      // Use basename so ffmpeg resolves paths relative to the manifest's own
      // directory (framesDir) rather than the process cwd — avoids path doubling.
      frames.push({ file: path.basename(file), tsMs: Date.now() });
      frameIdx++;
      try {
        await client.send('Page.screencastFrameAck', { sessionId: e.sessionId });
      } catch { /* tearing down */ }
    });
    await client.send('Page.startScreencast', { format: 'jpeg', quality: 85, everyNthFrame: 1 });

    const captureStart = Date.now();
    while (!(await page.evaluate('window.__mosaicDone'))) {
      if (Date.now() - captureStart > expectedMs + SAFETY_SLACK_MS) break;
      onProgress(Math.min(total, Math.round(((Date.now() - captureStart) / expectedMs) * total * 0.5)), total);
      await new Promise((r) => setTimeout(r, DONE_POLL_MS));
    }
    await client.send('Page.stopScreencast');
    onProgress(Math.floor(total * 0.5), total);

    // Phase 2: encode from concat manifest.
    const manifest = buildConcatManifest(frames);
    const manifestPath = path.join(framesDir, 'manifest.txt');
    fs.writeFileSync(manifestPath, manifest);

    await new Promise<void>((resolve, reject) => {
      const ff = spawn('ffmpeg', [
        '-y',
        '-f', 'concat', '-safe', '0',
        '-i', manifestPath,
        // setpts restores real-time speed (each timestamp ÷ slow)
        '-vf', `setpts=PTS/${slow},fps=${fps}`,
        '-c:v', 'libx264',
        '-preset', 'veryfast',
        '-pix_fmt', 'yuv420p',
        '-crf', '20',
        '-an',
        output,
      ], { stdio: ['ignore', 'inherit', 'inherit'] });
      ff.on('close', (code) => {
        onProgress(total, total);
        code === 0 ? resolve() : reject(new Error(`ffmpeg exited with code ${code}`));
      });
      ff.on('error', reject);
    });

    return { outputUrl: `/data/exports/${filename}` };
  } finally {
    await browser.close();
    fs.rmSync(framesDir, { recursive: true, force: true });
  }
}

const WIDTH = 1920;
const HEIGHT = 1080;
const DONE_POLL_MS = 250;
const SAFETY_SLACK_MS = 15_000; // stop a bit past the expected end if __mosaicDone never flips

const CHROMIUM_ARGS = [
  '--no-sandbox',
  '--disable-dev-shm-usage',
  '--hide-scrollbars',
  '--force-color-profile=srgb',
];

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
    executablePath: findChromium(),
    headless: true,
    args: CHROMIUM_ARGS,
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
