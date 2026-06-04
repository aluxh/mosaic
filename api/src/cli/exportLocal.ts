import path from 'node:path';
import { renderVideoHiFi } from '../lib/exportVideo.js';

// High-fidelity local export: two-phase (capture then encode) with optional
// slow-motion time-scaling for smooth high-fps output. Run on a capable machine
// pointed at a render URL — capture only touches the rendered page, never the DB.
//
// Usage:
//   PUPPETEER_EXECUTABLE_PATH="<path to Chrome>" \
//     npx tsx src/cli/exportLocal.ts <renderUrl> [eventId] [outDir] [slow] [fps] [slideMs]
//
//   renderUrl  e.g. https://remembering-gm.aluxh.synology.me  (no /?render=1)
//   eventId    label for the output filename (default: "export")
//   outDir     where to write exports/<file>.mp4 (default: current directory)
//   slow       time-scale factor (default: 1). slow=2 captures 2× slower then
//              speeds back up, doubling effective frame rate. slow=2.5 + fps=60
//              gives genuinely smooth 60fps. Capture takes ~slow× the show length.
//   fps        output fps (default: 30). Use 60 for smooth output with slow≥2.
//   slideMs    per-slide display duration in ms (default: live wall value —
//              4200ms celebration / 7200ms remembrance). Only affects the export.
//
// Requires ffmpeg on PATH and a Chrome/Chromium binary (set
// PUPPETEER_EXECUTABLE_PATH, or it falls back to /usr/bin/chromium).

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const [renderUrl, eventId = 'export', outDir = process.cwd(), slowArg = '1', fpsArg = '30', slideMsArg] = args;
  if (!renderUrl) {
    console.error('usage: tsx src/cli/exportLocal.ts <renderUrl> [eventId] [outDir] [slow] [fps] [slideMs]');
    process.exit(1);
  }
  const slow = Math.max(0.1, Number(slowArg) || 1);
  const fps = Math.max(1, Math.round(Number(fpsArg) || 30));
  const slideMs = slideMsArg ? Math.max(500, Math.round(Number(slideMsArg) || 0)) : undefined;

  console.error(
    `Exporting ${renderUrl}/?render=1&slow=${slow} → ${path.join(outDir, 'exports')} (slow=${slow} fps=${fps}${slideMs ? ` slideMs=${slideMs}` : ''})\n` +
    `  capture will take ≈${slow}× the show length; set slow≥2.5 for smooth 60fps`,
  );
  const { outputUrl } = await renderVideoHiFi(
    { renderUrl, outDir, eventId, slow, fps, slideMs },
    (done, total) => { process.stderr.write(`\r${done}/${total}`); },
  );

  const file = path.join(outDir, 'exports', path.basename(outputUrl));
  console.error(`\nDone: ${file}`);
}

main().catch((err) => {
  console.error('\nFailed:', err instanceof Error ? err.message : String(err));
  process.exit(1);
});
