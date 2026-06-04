import path from 'node:path';
import { renderVideo } from '../lib/exportVideo.js';

// One-off local export: run the same headless capture as the in-API export, but
// on a capable machine, pointed at a render URL (the public wall works — capture
// only screenshots the rendered page, it never touches the DB). The NAS is too
// underpowered to finish the full sequence; a laptop renders it in a fraction of
// the time.
//
// Usage:
//   PUPPETEER_EXECUTABLE_PATH="<path to Chrome>" \
//     npx tsx src/cli/exportLocal.ts <renderUrl> [eventId] [outDir]
//
//   renderUrl  e.g. https://remembering-gm.aluxh.synology.me  (no /?render=1)
//   eventId    label for the output filename (default: "export")
//   outDir     where to write exports/<file>.mp4 (default: current directory)
//
// Requires ffmpeg on PATH and a Chrome/Chromium binary (set
// PUPPETEER_EXECUTABLE_PATH, or it falls back to /usr/bin/chromium).

async function main(): Promise<void> {
  const [renderUrl, eventId = 'export', outDir = process.cwd()] = process.argv.slice(2);
  if (!renderUrl) {
    console.error('usage: tsx src/cli/exportLocal.ts <renderUrl> [eventId] [outDir]');
    process.exit(1);
  }

  console.error(`Exporting ${renderUrl}/?render=1 → ${path.join(outDir, 'exports')}`);
  const { outputUrl } = await renderVideo({ renderUrl, outDir, eventId }, (done, total) => {
    process.stderr.write(`\r${done}/${total} frames`);
  });

  const file = path.join(outDir, 'exports', path.basename(outputUrl));
  console.error(`\nDone: ${file}`);
}

main().catch((err) => {
  console.error('\nFailed:', err instanceof Error ? err.message : String(err));
  process.exit(1);
});
