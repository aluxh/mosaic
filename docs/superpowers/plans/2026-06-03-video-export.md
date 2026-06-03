# Slideshow → MP4 Export Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an admin-triggered "Export video" feature that records the live slideshow (via a headless Chromium playing a render-mode of the web app) and encodes it to a 1920×1080 H.264 MP4 with ffmpeg, downloadable from `/data/exports/`.

**Architecture:** A `?render=1` mode in the web app plays the real slideshow once, slides-only, exposing a `window.__mosaicRender`/`window.__mosaicDone` contract. The API gains an in-process background job (Puppeteer + virtual-time stepping → ffmpeg) wired to two admin-authenticated endpoints (`POST`/`GET /api/events/:id/admin/export`). The Admin UI gets a button that starts the job and polls for status/progress, then shows a download link. Chromium + ffmpeg are added to the API Docker image.

**Tech Stack:** TypeScript, Fastify, `puppeteer-core` (system Chromium via CDP), ffmpeg (child process), React 18, Vitest + Testing Library.

**Spec:** `../mosaic-specs/v0.9-video-export-spec.md`

> **Spec deviation (intentional):** the spec's shorthand `POST /api/admin/export` is implemented as the event-scoped `POST /api/events/:id/admin/export`. The existing `makeRequireAdmin` handler derives the event id from `req.params.id` to verify the token's scope, so the route MUST carry `:id`. This matches every other admin route.

---

## File structure

**API (create):**
- `api/src/lib/exportVideo.ts` — pure helpers (`totalFrames`, `buildFfmpegArgs`) + the heavy `renderVideo` runner (Puppeteer + ffmpeg).
- `api/src/lib/exportJob.ts` — in-memory job state machine (`createExportJobManager`) and shared types (`ExportJob`, `RenderRunner`, `RenderOpts`, `ExportJobManager`).
- `api/src/routes/export.ts` — `registerExportRoutes` (POST start / GET status).
- `api/test/exportVideo.test.ts`, `api/test/exportJob.test.ts`, `api/test/export.routes.test.ts`.

**API (modify):**
- `api/src/server.ts` — wire the manager, runner, and routes; read `RENDER_URL`.
- `api/package.json` — add `puppeteer-core` dependency.
- `Dockerfile.api` — install `chromium`, `ffmpeg`, fonts; set `PUPPETEER_EXECUTABLE_PATH`.

**Web (create):**
- `web/src/render-globals.d.ts` — ambient `Window` typing for the render contract.
- `web/src/RenderApp.tsx` — slides-only page used by `?render=1`.
- `web/src/test/Wall.test.tsx`, `web/src/test/RenderApp.test.tsx`.

**Web (modify):**
- `web/src/components/Wall.tsx` — add `renderMode` prop (no loop, no pause, sets window contract).
- `web/src/main.tsx` — `selectPage` returns `RenderApp` when `?render` is present.
- `web/src/test/main.test.tsx` — cover the render route.
- `web/src/lib/adminApi.ts` — `startExport` + `getExportStatus` client functions + `ExportStatus` type.
- `web/src/AdminApp.tsx` — "Export video" button + status/progress/download UI.
- `web/src/test/AdminApp.test.tsx` — cover the export button.

---

## Task 1: Pure helpers — `totalFrames` and `buildFfmpegArgs`

**Files:**
- Create: `api/src/lib/exportVideo.ts`
- Test: `api/test/exportVideo.test.ts`

- [ ] **Step 1: Write the failing test**

Create `api/test/exportVideo.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { totalFrames, buildFfmpegArgs } from '../src/lib/exportVideo.js';

describe('totalFrames', () => {
  it('returns 0 for an empty sequence', () => {
    expect(totalFrames({ sequenceLength: 0, slideMs: 4200, fps: 30 })).toBe(0);
  });

  it('multiplies seconds of playback by fps', () => {
    // 3 slides * 4.2s = 12.6s * 30fps = 378 frames
    expect(totalFrames({ sequenceLength: 3, slideMs: 4200, fps: 30 })).toBe(378);
    // 9 slides * 7.2s = 64.8s * 30fps = 1944 frames
    expect(totalFrames({ sequenceLength: 9, slideMs: 7200, fps: 30 })).toBe(1944);
  });
});

describe('buildFfmpegArgs', () => {
  it('builds image2pipe → H.264 yuv420p args with the right resolution, fps, no audio, and output', () => {
    const args = buildFfmpegArgs({ width: 1920, height: 1080, fps: 30, output: '/data/exports/out.mp4' });
    expect(args).toContain('image2pipe');
    expect(args.join(' ')).toContain('scale=1920:1080');
    expect(args).toContain('libx264');
    const i = args.indexOf('-pix_fmt');
    expect(args[i + 1]).toBe('yuv420p');
    const r = args.indexOf('-r');
    expect(args[r + 1]).toBe('30');
    expect(args).toContain('-an');
    expect(args[args.length - 1]).toBe('/data/exports/out.mp4');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd api && npx vitest run test/exportVideo.test.ts`
Expected: FAIL — `Cannot find module '../src/lib/exportVideo.js'` / `totalFrames is not a function`.

- [ ] **Step 3: Write minimal implementation**

Create `api/src/lib/exportVideo.ts`:

```ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd api && npx vitest run test/exportVideo.test.ts`
Expected: PASS (5 assertions across 3 tests).

- [ ] **Step 5: Commit**

```bash
git add api/src/lib/exportVideo.ts api/test/exportVideo.test.ts
git commit -m "feat: add video-export pure helpers (totalFrames, buildFfmpegArgs)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: Export job manager (in-memory state machine)

**Files:**
- Create: `api/src/lib/exportJob.ts`
- Test: `api/test/exportJob.test.ts`

- [ ] **Step 1: Write the failing test**

Create `api/test/exportJob.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { createExportJobManager, type RenderRunner } from '../src/lib/exportJob.js';

const flush = () => new Promise((r) => setTimeout(r, 0));
const opts = { renderUrl: 'http://web', outDir: '/data', eventId: 'remembrance' };

describe('createExportJobManager', () => {
  it('starts idle', () => {
    const m = createExportJobManager(vi.fn());
    expect(m.get()).toEqual({ status: 'idle' });
  });

  it('start() transitions to running and invokes the runner with opts', () => {
    const runner: RenderRunner = vi.fn(() => new Promise(() => {})); // never resolves
    const m = createExportJobManager(runner);
    const res = m.start(opts);
    expect(res.started).toBe(true);
    expect(m.get().status).toBe('running');
    expect(runner).toHaveBeenCalledWith(opts, expect.any(Function));
  });

  it('a second start() while running returns started:false with the running job', () => {
    const m = createExportJobManager(() => new Promise(() => {}));
    m.start(opts);
    const second = m.start(opts);
    expect(second.started).toBe(false);
    expect(second.job.status).toBe('running');
  });

  it('onProgress updates framesDone/totalFrames', () => {
    let report!: (d: number, t: number) => void;
    const m = createExportJobManager((_o, onProgress) => {
      report = onProgress;
      return new Promise(() => {});
    });
    m.start(opts);
    report(5, 10);
    expect(m.get()).toMatchObject({ status: 'running', framesDone: 5, totalFrames: 10 });
  });

  it('resolves to done with the output url', async () => {
    const m = createExportJobManager(async () => ({ outputUrl: '/data/exports/x.mp4' }));
    m.start(opts);
    await flush();
    expect(m.get()).toMatchObject({ status: 'done', outputUrl: '/data/exports/x.mp4' });
  });

  it('rejects to error with the message', async () => {
    const m = createExportJobManager(async () => {
      throw new Error('boom');
    });
    m.start(opts);
    await flush();
    expect(m.get()).toEqual({ status: 'error', error: 'boom' });
  });

  it('allows a new run after one finished', async () => {
    const m = createExportJobManager(async () => ({ outputUrl: '/data/exports/x.mp4' }));
    m.start(opts);
    await flush();
    const again = m.start(opts);
    expect(again.started).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd api && npx vitest run test/exportJob.test.ts`
Expected: FAIL — `Cannot find module '../src/lib/exportJob.js'`.

- [ ] **Step 3: Write minimal implementation**

Create `api/src/lib/exportJob.ts`:

```ts
export type ExportJob =
  | { status: 'idle' }
  | { status: 'running'; startedAt: number; framesDone: number; totalFrames: number }
  | { status: 'done'; finishedAt: number; outputUrl: string }
  | { status: 'error'; error: string };

export interface RenderOpts {
  renderUrl: string;
  outDir: string;
  eventId: string;
}

export type RenderRunner = (
  opts: RenderOpts,
  onProgress: (framesDone: number, totalFrames: number) => void,
) => Promise<{ outputUrl: string }>;

export interface ExportJobManager {
  get(): ExportJob;
  start(opts: RenderOpts): { started: boolean; job: ExportJob };
}

export function createExportJobManager(runner: RenderRunner): ExportJobManager {
  let job: ExportJob = { status: 'idle' };

  return {
    get: () => job,
    start(opts) {
      if (job.status === 'running') return { started: false, job };
      job = { status: 'running', startedAt: Date.now(), framesDone: 0, totalFrames: 0 };
      runner(opts, (framesDone, totalFrames) => {
        if (job.status === 'running') job = { ...job, framesDone, totalFrames };
      })
        .then(({ outputUrl }) => {
          job = { status: 'done', finishedAt: Date.now(), outputUrl };
        })
        .catch((e) => {
          job = { status: 'error', error: e instanceof Error ? e.message : String(e) };
        });
      return { started: true, job };
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd api && npx vitest run test/exportJob.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add api/src/lib/exportJob.ts api/test/exportJob.test.ts
git commit -m "feat: add in-memory export job manager

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: Export routes (`POST`/`GET /api/events/:id/admin/export`)

**Files:**
- Create: `api/src/routes/export.ts`
- Test: `api/test/export.routes.test.ts`

- [ ] **Step 1: Write the failing test**

Create `api/test/export.routes.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { makeRequireAdmin } from '../src/lib/auth.js';
import { signToken } from '../src/lib/token.js';
import { createExportJobManager } from '../src/lib/exportJob.js';
import { registerExportRoutes } from '../src/routes/export.js';

const SECRET = 'export-routes-secret';
const adminAuth = (eid = 'remembrance') =>
  `Bearer ${signToken({ eid, exp: Math.floor(Date.now() / 1000) + 3600, role: 'admin' }, SECRET)}`;
const guestAuth = (eid = 'remembrance') =>
  `Bearer ${signToken({ eid, exp: Math.floor(Date.now() / 1000) + 3600 }, SECRET)}`;

let app: FastifyInstance;

function build(runner = () => new Promise<{ outputUrl: string }>(() => {})) {
  app = Fastify();
  const manager = createExportJobManager(runner);
  registerExportRoutes(app, makeRequireAdmin(SECRET), manager, {
    renderUrl: 'http://web',
    outDir: '/tmp',
  });
  return manager;
}

beforeEach(async () => {
  build();
  await app.ready();
});
afterEach(async () => {
  await app.close();
});

const url = '/api/events/remembrance/admin/export';

describe('export routes auth', () => {
  it('POST 401 without a token and with a guest token', async () => {
    expect((await app.inject({ method: 'POST', url })).statusCode).toBe(401);
    expect((await app.inject({ method: 'POST', url, headers: { authorization: guestAuth() } })).statusCode).toBe(401);
  });

  it('GET 401 without a token', async () => {
    expect((await app.inject({ method: 'GET', url })).statusCode).toBe(401);
  });
});

describe('export routes lifecycle', () => {
  it('POST starts a render and returns the running job', async () => {
    const res = await app.inject({ method: 'POST', url, headers: { authorization: adminAuth() } });
    expect(res.statusCode).toBe(200);
    expect((res.json() as { status: string }).status).toBe('running');
  });

  it('a second POST while running returns 409 with the running job', async () => {
    await app.inject({ method: 'POST', url, headers: { authorization: adminAuth() } });
    const res = await app.inject({ method: 'POST', url, headers: { authorization: adminAuth() } });
    expect(res.statusCode).toBe(409);
    expect((res.json() as { status: string }).status).toBe('running');
  });

  it('GET returns the current job state', async () => {
    const idle = await app.inject({ method: 'GET', url, headers: { authorization: adminAuth() } });
    expect((idle.json() as { status: string }).status).toBe('idle');
    await app.inject({ method: 'POST', url, headers: { authorization: adminAuth() } });
    const running = await app.inject({ method: 'GET', url, headers: { authorization: adminAuth() } });
    expect((running.json() as { status: string }).status).toBe('running');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd api && npx vitest run test/export.routes.test.ts`
Expected: FAIL — `Cannot find module '../src/routes/export.js'`.

- [ ] **Step 3: Write minimal implementation**

Create `api/src/routes/export.ts`:

```ts
import type { FastifyInstance, preHandlerHookHandler } from 'fastify';
import type { ExportJobManager } from '../lib/exportJob.js';

export function registerExportRoutes(
  app: FastifyInstance,
  requireAdmin: preHandlerHookHandler,
  manager: ExportJobManager,
  config: { renderUrl: string; outDir: string },
): void {
  app.post<{ Params: { id: string } }>(
    '/api/events/:id/admin/export',
    { preHandler: requireAdmin },
    async (req, reply) => {
      const { started, job } = manager.start({
        renderUrl: config.renderUrl,
        outDir: config.outDir,
        eventId: req.params.id,
      });
      if (!started) return reply.code(409).send(job);
      return job;
    },
  );

  app.get<{ Params: { id: string } }>(
    '/api/events/:id/admin/export',
    { preHandler: requireAdmin },
    async () => manager.get(),
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd api && npx vitest run test/export.routes.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add api/src/routes/export.ts api/test/export.routes.test.ts
git commit -m "feat: add admin export routes (start/status)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: The render runner (`renderVideo`)

This is the heavy integration piece (real Chromium + ffmpeg). It has no unit test — it is verified end-to-end in Task 10. Verify only that it type-checks here.

**Files:**
- Modify: `api/package.json` (add dependency)
- Modify: `api/src/lib/exportVideo.ts` (append `renderVideo`)

- [ ] **Step 1: Add the `puppeteer-core` dependency**

Run: `cd api && npm install puppeteer-core@^23.11.1 --save`
Expected: `package.json` gains `"puppeteer-core": "^23.11.1"` under dependencies and `package-lock.json` updates. (`puppeteer-core` does not download a browser; the container provides system Chromium.)

- [ ] **Step 2: Append the runner to `api/src/lib/exportVideo.ts`**

Add these imports at the TOP of `api/src/lib/exportVideo.ts` (above the existing helpers):

```ts
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer-core';
import type { RenderRunner } from './exportJob.js';
```

Append at the END of the file:

```ts
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

  const browser = await puppeteer.launch({
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH ?? '/usr/bin/chromium',
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--hide-scrollbars', '--force-color-profile=srgb'],
  });

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: WIDTH, height: HEIGHT, deviceScaleFactor: 1 });
    const client = await page.target().createCDPSession();

    // Let the page load (including data fetches) under virtual time, then pause.
    await client.send('Emulation.setVirtualTimePolicy', {
      policy: 'pauseIfNetworkFetchesPending',
      budget: 5000,
    });
    await page.goto(`${renderUrl}/?render=1`, { waitUntil: 'networkidle0' });
    await page.waitForFunction('!!window.__mosaicRender', { timeout: 15000 });

    const meta = (await page.evaluate('window.__mosaicRender')) as {
      fps: number;
      sequenceLength: number;
      slideMs: number;
    };
    const total = totalFrames(meta);
    if (total === 0) throw new Error('nothing to export — this event has no photos yet');
    const frameCap = total + meta.fps * FRAME_CAP_SLACK_SECONDS;
    const budgetMs = 1000 / meta.fps;

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
```

- [ ] **Step 3: Type-check**

Run: `cd api && npm run typecheck`
Expected: PASS (no type errors). If `puppeteer-core` types complain about the CDP event name, that is fine at runtime — but the code above uses only typed surfaces; resolve any error before continuing.

- [ ] **Step 4: Commit**

```bash
git add api/src/lib/exportVideo.ts api/package.json api/package-lock.json
git commit -m "feat: add renderVideo runner (puppeteer virtual-time capture + ffmpeg)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 5: Wire the export feature into the server

**Files:**
- Modify: `api/src/server.ts`

- [ ] **Step 1: Add imports**

In `api/src/server.ts`, after the existing route imports (the block ending with `import { registerJoinRoute } from './routes/join.js';`), add:

```ts
import { registerExportRoutes } from './routes/export.js';
import { createExportJobManager } from './lib/exportJob.js';
import { renderVideo } from './lib/exportVideo.js';
```

- [ ] **Step 2: Register the routes**

In `api/src/server.ts`, find this line:

```ts
  registerAdminRoutes(app, db, paths, makeRequireAdmin(tokenSecret), liveUpdates);
```

Add immediately AFTER it:

```ts
  const renderUrl = (process.env.RENDER_URL ?? 'http://web').replace(/\/$/, '');
  const exportManager = createExportJobManager(renderVideo);
  registerExportRoutes(app, makeRequireAdmin(tokenSecret), exportManager, {
    renderUrl,
    outDir: paths.dataDir,
  });
```

- [ ] **Step 3: Type-check and run the full API suite**

Run: `cd api && npm run typecheck && npx vitest run`
Expected: PASS — all existing tests plus the three new export test files. No regressions.

- [ ] **Step 4: Commit**

```bash
git add api/src/server.ts
git commit -m "feat: wire export routes + job manager into the API server

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 6: Add Chromium + ffmpeg to the API image

**Files:**
- Modify: `Dockerfile.api`

- [ ] **Step 1: Extend the apt install layer**

In `Dockerfile.api`, find the `RUN apt-get update && apt-get install -y --no-install-recommends \` block. Add `chromium`, `ffmpeg`, and `fonts-liberation` to the package list. The amended block reads:

```dockerfile
RUN apt-get update && apt-get install -y --no-install-recommends \
      pkg-config python3 make g++ \
      libvips-dev libheif-plugin-libde265 \
      libcairo2-dev libpango1.0-dev libjpeg-dev libgif-dev librsvg2-dev \
      chromium ffmpeg fonts-liberation \
    && rm -rf /var/lib/apt/lists/* \
    && npm install -g --no-audit --no-fund node-addon-api@^7 node-gyp
```

(`chromium` pulls in the shared libraries Puppeteer needs; `fonts-liberation` covers Chromium's font fallback. The app's own `@fontsource` fonts arrive via the served web build.)

- [ ] **Step 2: Point Puppeteer at the system Chromium**

In `Dockerfile.api`, find the existing env block:

```dockerfile
ENV SHARP_FORCE_GLOBAL_LIBVIPS=1
ENV NODE_PATH=/usr/local/lib/node_modules
```

Add immediately after it:

```dockerfile
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
```

- [ ] **Step 3: Build the image to verify the layer**

Run: `docker build -f Dockerfile.api -t mosaic-api:export-check .`
Expected: build succeeds; the apt layer installs chromium + ffmpeg without error.

- [ ] **Step 4: Sanity-check the binaries inside the image**

Run: `docker run --rm mosaic-api:export-check sh -c "/usr/bin/chromium --version && ffmpeg -version | head -1"`
Expected: prints a Chromium version line and an ffmpeg version line.

- [ ] **Step 5: Commit**

```bash
git add Dockerfile.api
git commit -m "build: add chromium + ffmpeg to the API image for video export

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 7: Web render contract — `Wall` render mode

**Files:**
- Create: `web/src/render-globals.d.ts`
- Modify: `web/src/components/Wall.tsx`
- Test: `web/src/test/Wall.test.tsx`

- [ ] **Step 1: Add the ambient window typing**

Create `web/src/render-globals.d.ts`:

```ts
export {};

declare global {
  interface Window {
    __mosaicRender?: { fps: number; sequenceLength: number; slideMs: number };
    __mosaicDone?: boolean;
  }
}
```

- [ ] **Step 2: Write the failing test**

Create `web/src/test/Wall.test.tsx`:

```tsx
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, act } from '@testing-library/react';
import { Wall } from '../components/Wall';
import { buildSequence } from '../lib/buildSequence';
import type { Event, Photo } from '../types';

const event: Event = {
  id: 'e', mode: 'celebration', eyebrow: '', title: 'T', dateline: '', place: '',
  invitation: '', brandSub: '', shortCode: 'X', transitionStyle: 'default',
};
const photo = (id: string): Photo => ({
  id, eventId: 'e', source: 'seed', url: `/${id}.jpg`, url1024: `/${id}.jpg`,
  url320: `/${id}.jpg`, credit: '', createdAt: 0, focalX: 0.5, focalY: 0.5,
});

beforeEach(() => {
  vi.useFakeTimers();
  window.__mosaicRender = undefined;
  window.__mosaicDone = undefined;
});
afterEach(() => {
  vi.useRealTimers();
});

describe('Wall render mode', () => {
  it('publishes the render contract and signals done after one pass (no loop)', () => {
    const photos = [photo('a'), photo('b'), photo('c')];
    const seq = buildSequence(photos, [], 'celebration', event);
    expect(seq.length).toBeGreaterThan(1);

    act(() => {
      render(
        <Wall photos={photos} messages={[]} mode="celebration" paused={false} event={event} renderMode />,
      );
    });

    expect(window.__mosaicRender).toEqual({ fps: 30, sequenceLength: seq.length, slideMs: 4200 });
    expect(window.__mosaicDone).toBe(false);

    // Play through every slide (4200ms each) plus the final hold.
    act(() => {
      vi.advanceTimersByTime(4200 * (seq.length + 1));
    });
    expect(window.__mosaicDone).toBe(true);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd web && npx vitest run src/test/Wall.test.tsx`
Expected: FAIL — `renderMode` is not a prop; `window.__mosaicRender` stays `undefined`.

- [ ] **Step 4: Implement `renderMode` in `Wall`**

In `web/src/components/Wall.tsx`, add `renderMode` to the props interface:

```ts
interface WallProps {
  photos: Photo[];
  messages: Message[];
  mode: Mode;
  paused: boolean;
  event: Event | null;
  renderMode?: boolean;
}
```

Update the component signature to destructure it:

```ts
export const Wall = forwardRef<WallHandle, WallProps>(function Wall(
  { photos, messages, mode, paused, event, renderMode = false }: WallProps,
  ref,
) {
```

Add a constant near the other timing constants (just after `const fadeDur = ...`):

```ts
  const RENDER_FPS = 30;
```

Replace the existing auto-advance effect:

```ts
  useEffect(() => {
    if (paused || sequence.length === 0) return;
    const t = setTimeout(() => setIdx((i) => (i + 1) % sequence.length), slideMs);
    return () => clearTimeout(t);
  }, [idx, paused, sequence.length, slideMs]);
```

with this render-aware version:

```ts
  useEffect(() => {
    if (sequence.length === 0) return;
    if (renderMode) {
      // Play once: advance to the last slide, then mark done — never wrap.
      if (idx >= sequence.length - 1) {
        const t = setTimeout(() => {
          window.__mosaicDone = true;
        }, slideMs);
        return () => clearTimeout(t);
      }
      const t = setTimeout(() => setIdx((i) => i + 1), slideMs);
      return () => clearTimeout(t);
    }
    if (paused) return;
    const t = setTimeout(() => setIdx((i) => (i + 1) % sequence.length), slideMs);
    return () => clearTimeout(t);
  }, [idx, paused, sequence.length, slideMs, renderMode]);
```

Add a new effect immediately after it to publish the contract:

```ts
  useEffect(() => {
    if (!renderMode) return;
    window.__mosaicDone = false;
    if (sequence.length > 0) {
      window.__mosaicRender = { fps: RENDER_FPS, sequenceLength: sequence.length, slideMs };
    }
  }, [renderMode, sequence.length, slideMs]);
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd web && npx vitest run src/test/Wall.test.tsx`
Expected: PASS.

- [ ] **Step 6: Run the full web suite to confirm no regression**

Run: `cd web && npx vitest run`
Expected: PASS — existing Wall/slide tests still green (default mode unchanged).

- [ ] **Step 7: Commit**

```bash
git add web/src/render-globals.d.ts web/src/components/Wall.tsx web/src/test/Wall.test.tsx
git commit -m "feat: add Wall render mode (play once, publish render contract)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 8: `RenderApp` page + `?render=1` routing

**Files:**
- Create: `web/src/RenderApp.tsx`
- Modify: `web/src/main.tsx`
- Test: `web/src/test/RenderApp.test.tsx`, `web/src/test/main.test.tsx`

- [ ] **Step 1: Write the failing routing test**

Replace the body of `web/src/test/main.test.tsx` with:

```tsx
import { describe, it, expect, afterEach } from 'vitest';
import { selectPage } from '../main';
import { App } from '../App';
import { AdminApp } from '../AdminApp';
import { RenderApp } from '../RenderApp';

afterEach(() => {
  window.history.replaceState({}, '', '/');
});

describe('selectPage', () => {
  it('routes /admin to AdminApp', () => {
    expect(selectPage('/admin')).toBe(AdminApp);
  });

  it('routes / to App', () => {
    expect(selectPage('/')).toBe(App);
  });

  it('routes any other path to App', () => {
    expect(selectPage('/whatever')).toBe(App);
  });

  it('routes ?render=1 to RenderApp', () => {
    expect(selectPage('/', '?render=1')).toBe(RenderApp);
  });

  it('render param wins over /admin', () => {
    expect(selectPage('/admin', '?render=1')).toBe(RenderApp);
  });
});
```

- [ ] **Step 2: Write the failing RenderApp test**

Create `web/src/test/RenderApp.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import * as api from '../lib/api';
import { RenderApp } from '../RenderApp';
import type { Event, Photo } from '../types';

const event: Event = {
  id: 'remembrance', mode: 'remembrance', eyebrow: '', title: 'T', dateline: '', place: '',
  invitation: '', brandSub: 'sub', shortCode: 'X', transitionStyle: 'default',
};
const photo = (id: string): Photo => ({
  id, eventId: 'remembrance', source: 'seed', url: `/${id}.jpg`, url1024: `/${id}.jpg`,
  url320: `/${id}.jpg`, credit: '', createdAt: 0, focalX: 0.5, focalY: 0.5,
});

beforeEach(() => {
  window.__mosaicRender = undefined;
  vi.spyOn(api, 'fetchEvents').mockResolvedValue([event]);
  vi.spyOn(api, 'fetchPhotos').mockResolvedValue([photo('a'), photo('b')]);
  vi.spyOn(api, 'fetchMessages').mockResolvedValue([]);
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('RenderApp', () => {
  it('renders slides only — no brand mark, counters, nav, or contribute chrome', async () => {
    render(<RenderApp />);
    await waitFor(() => expect(window.__mosaicRender).toBeTruthy());
    expect(screen.queryByText('Mosaic')).not.toBeInTheDocument();
    expect(screen.queryByText(/add to the wall/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/^Photos$/)).not.toBeInTheDocument();
    expect(screen.queryByText(/^Live$/)).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 3: Run both tests to verify they fail**

Run: `cd web && npx vitest run src/test/main.test.tsx src/test/RenderApp.test.tsx`
Expected: FAIL — `Cannot find module '../RenderApp'`.

- [ ] **Step 4: Create `RenderApp`**

Create `web/src/RenderApp.tsx`:

```tsx
import { useEffect, useState } from 'react';
import { Wall } from './components/Wall';
import { fetchEvents, fetchPhotos, fetchMessages } from './lib/api';
import type { Event, Message, Photo } from './types';

// Slides-only page used by the server-side video exporter (`?render=1`).
// One frozen snapshot, no chrome, no live polling.
export function RenderApp() {
  const [event, setEvent] = useState<Event | null>(null);
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const events = await fetchEvents();
      const ev = events[0];
      if (!ev || cancelled) return;
      const [p, m] = await Promise.all([fetchPhotos(ev.id), fetchMessages(ev.id)]);
      if (cancelled) return;
      setEvent(ev);
      setPhotos(p);
      setMessages(m);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (!event) return null;

  return (
    <div
      className={`fixed inset-0 ${event.mode === 'celebration' ? 'mode-celebration' : 'mode-remembrance'}`}
    >
      <Wall photos={photos} messages={messages} mode={event.mode} paused={false} event={event} renderMode />
    </div>
  );
}
```

- [ ] **Step 5: Update `selectPage` in `web/src/main.tsx`**

Add the import alongside the existing page imports:

```ts
import { RenderApp } from './RenderApp';
```

Replace the `selectPage` function and its call site:

```ts
export function selectPage(pathname: string, search = ''): ComponentType {
  if (new URLSearchParams(search).has('render')) return RenderApp;
  return pathname === '/admin' ? AdminApp : App;
}

const Page = selectPage(window.location.pathname, window.location.search);
```

- [ ] **Step 6: Run both tests to verify they pass**

Run: `cd web && npx vitest run src/test/main.test.tsx src/test/RenderApp.test.tsx`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add web/src/RenderApp.tsx web/src/main.tsx web/src/test/main.test.tsx web/src/test/RenderApp.test.tsx
git commit -m "feat: add RenderApp page and ?render=1 routing

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 9: Admin "Export video" button + status polling

**Files:**
- Modify: `web/src/lib/adminApi.ts`
- Modify: `web/src/AdminApp.tsx`
- Test: `web/src/test/AdminApp.test.tsx`

- [ ] **Step 1: Write the failing UI tests**

Append to `web/src/test/AdminApp.test.tsx` (after the existing `describe` blocks, before EOF):

```tsx
describe('AdminApp video export', () => {
  beforeEach(() => {
    window.location.hash = '#t=admintok';
    vi.spyOn(adminApi, 'fetchAdminPhotos').mockResolvedValue([photo('p1')]);
    vi.spyOn(adminApi, 'fetchAdminMessages').mockResolvedValue([]);
  });

  it('starts a render and shows a download link when done', async () => {
    vi.spyOn(adminApi, 'startExport').mockResolvedValue({
      status: 'running', startedAt: 1, framesDone: 0, totalFrames: 100,
    });
    vi.spyOn(adminApi, 'getExportStatus').mockResolvedValue({
      status: 'done', finishedAt: 2, outputUrl: '/data/exports/x.mp4',
    });
    render(<AdminApp />);
    await screen.findAllByRole('img');
    fireEvent.click(screen.getByRole('button', { name: /export video/i }));
    await waitFor(() => expect(adminApi.startExport).toHaveBeenCalledWith('remembrance', 'admintok'));
    const link = await screen.findByRole('link', { name: /download video/i });
    expect(link).toHaveAttribute('href', '/data/exports/x.mp4');
  });

  it('disables the button and shows progress while running', async () => {
    vi.spyOn(adminApi, 'startExport').mockResolvedValue({
      status: 'running', startedAt: 1, framesDone: 10, totalFrames: 100,
    });
    vi.spyOn(adminApi, 'getExportStatus').mockResolvedValue({
      status: 'running', startedAt: 1, framesDone: 20, totalFrames: 100,
    });
    render(<AdminApp />);
    await screen.findAllByRole('img');
    fireEvent.click(screen.getByRole('button', { name: /export video/i }));
    await waitFor(() => expect(screen.getByRole('button', { name: /exporting/i })).toBeDisabled());
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd web && npx vitest run src/test/AdminApp.test.tsx`
Expected: FAIL — `adminApi.startExport` / `getExportStatus` are not functions; no "Export video" button.

- [ ] **Step 3: Add the client functions to `web/src/lib/adminApi.ts`**

Append at the END of `web/src/lib/adminApi.ts`:

```ts
export interface ExportStatus {
  status: 'idle' | 'running' | 'done' | 'error';
  startedAt?: number;
  framesDone?: number;
  totalFrames?: number;
  finishedAt?: number;
  outputUrl?: string;
  error?: string;
}

export async function startExport(eventId: string, token: string): Promise<ExportStatus> {
  const url = `/api/events/${eventId}/admin/export`;
  const res = await fetch(url, { method: 'POST', headers: authHeaders(token) });
  // 409 means a render is already running — its body is a valid status, not an error.
  if (res.status === 409) return (await res.json()) as ExportStatus;
  await ensureOk(res, url);
  return (await res.json()) as ExportStatus;
}

export async function getExportStatus(eventId: string, token: string): Promise<ExportStatus> {
  const url = `/api/events/${eventId}/admin/export`;
  const res = await ensureOk(await fetch(url, { headers: authHeaders(token) }), url);
  return (await res.json()) as ExportStatus;
}
```

- [ ] **Step 4: Wire the button into `web/src/AdminApp.tsx`**

Update the React import to add `useCallback` and `useRef`:

```ts
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
```

Add to the admin-api import block (the `from './lib/adminApi'` import) the new names and type:

```ts
import {
  fetchAdminPhotos,
  setPhotoHidden,
  deletePhoto,
  setTransitionStyle,
  fetchAdminMessages,
  setMessageHidden,
  deleteMessage,
  updatePhotoFocal,
  recalculatePhotoFocal,
  startExport,
  getExportStatus,
  type ExportStatus,
} from './lib/adminApi';
```

Add state + handlers near the other `useState` hooks (after `const [editingId, setEditingId] = useState<string | null>(null);`):

```ts
  const [exportStatus, setExportStatus] = useState<ExportStatus | null>(null);
  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const pollExport = useCallback(() => {
    if (!event || !token) return;
    getExportStatus(event.id, token)
      .then((s) => {
        setExportStatus(s);
        if (s.status === 'running') pollRef.current = setTimeout(pollExport, 2000);
      })
      .catch((e) => setExportStatus({ status: 'error', error: String(e) }));
  }, [event, token]);

  useEffect(() => () => {
    if (pollRef.current) clearTimeout(pollRef.current);
  }, []);

  const onExport = async () => {
    if (!event || !token) return;
    try {
      const s = await startExport(event.id, token);
      setExportStatus(s);
      if (s.status === 'running') pollExport();
    } catch (e) {
      setExportStatus({ status: 'error', error: String(e) });
    }
  };
```

Add the button to the header. Replace the existing header block:

```tsx
      <header className="mb-6 flex items-center justify-between gap-4">
        <h1 className="serif text-2xl">Curate the wall</h1>
        <div className="flex rounded-full border border-neutral-700 overflow-hidden mono text-xs">
          {(['default', 'cinematic'] as const).map((s) => (
            <button
              key={s}
              onClick={() => onStyle(s)}
              className={`px-4 py-2 capitalize ${style === s ? 'bg-neutral-100 text-neutral-900' : 'text-neutral-300'}`}
            >
              {s}
            </button>
          ))}
        </div>
      </header>
```

with:

```tsx
      <header className="mb-6 flex items-center justify-between gap-4">
        <h1 className="serif text-2xl">Curate the wall</h1>
        <div className="flex items-center gap-3">
          <button
            onClick={onExport}
            disabled={exportStatus?.status === 'running'}
            className="px-4 py-2 rounded-full border border-neutral-700 mono text-xs hover:bg-neutral-800 disabled:opacity-50"
          >
            {exportStatus?.status === 'running' ? 'Exporting…' : 'Export video'}
          </button>
          <div className="flex rounded-full border border-neutral-700 overflow-hidden mono text-xs">
            {(['default', 'cinematic'] as const).map((s) => (
              <button
                key={s}
                onClick={() => onStyle(s)}
                className={`px-4 py-2 capitalize ${style === s ? 'bg-neutral-100 text-neutral-900' : 'text-neutral-300'}`}
              >
                {s}
              </button>
            ))}
          </div>
        </div>
      </header>
```

Add the status line immediately after the existing error paragraph. Find:

```tsx
      {error && <p className="mb-4 text-sm text-amber-400">{error}</p>}
```

Add AFTER it:

```tsx
      {exportStatus?.status === 'running' && (
        <p className="mb-4 text-sm text-neutral-300 mono">
          Rendering video… {exportStatus.framesDone ?? 0}/{exportStatus.totalFrames ?? 0} frames
        </p>
      )}
      {exportStatus?.status === 'done' && exportStatus.outputUrl && (
        <p className="mb-4 text-sm">
          <a href={exportStatus.outputUrl} download className="text-emerald-400 underline">
            Download video
          </a>
        </p>
      )}
      {exportStatus?.status === 'error' && (
        <p className="mb-4 text-sm text-amber-400">Export failed: {exportStatus.error}</p>
      )}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd web && npx vitest run src/test/AdminApp.test.tsx`
Expected: PASS — including the two new export tests.

- [ ] **Step 6: Type-check and run the full web suite**

Run: `cd web && npm run typecheck && npx vitest run`
Expected: PASS, no regressions.

- [ ] **Step 7: Commit**

```bash
git add web/src/lib/adminApi.ts web/src/AdminApp.tsx web/src/test/AdminApp.test.tsx
git commit -m "feat: add Export video button with status polling to admin

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 10: End-to-end verification (artifact-checked)

No unit test — this exercises real Chromium + ffmpeg against a running stack and verifies the produced MP4. Per the project rules, visual output is browser/artifact-verified.

**Files:** none (verification only).

- [ ] **Step 1: Bring up the stack with the export-ready image**

Run:
```bash
TOKEN_SECRET=$(openssl rand -hex 32) EVENT_MODE=remembrance docker compose up -d --build
```
Expected: `api` and `web` containers start; `api` boot log prints a guest token and an admin token (lines beginning with the QR URL or `#t=`). Save the **admin** token value.

- [ ] **Step 2: Confirm the render page serves**

Run: `curl -sI 'http://localhost/?render=1' | head -1`
Expected: `HTTP/1.1 200 OK` (nginx serves the SPA; the query param selects RenderApp client-side).

- [ ] **Step 3: Trigger an export through the API (as the admin would)**

Run (replace `<ADMIN_TOKEN>` with the saved token):
```bash
curl -s -X POST http://localhost/api/events/remembrance/admin/export \
  -H "Authorization: Bearer <ADMIN_TOKEN>"
```
Expected: JSON `{"status":"running",...}`.

- [ ] **Step 4: Poll until done**

Run:
```bash
curl -s http://localhost/api/events/remembrance/admin/export \
  -H "Authorization: Bearer <ADMIN_TOKEN>"
```
Repeat until `"status":"done"`. Expected final body contains `"outputUrl":"/data/exports/remembrance-<timestamp>.mp4"`. (Watch `docker compose logs -f api` for ffmpeg output if it stalls.)

- [ ] **Step 5: Probe the output file**

Run:
```bash
curl -s -o /tmp/mosaic-export.mp4 http://localhost/data/exports/$(ls -t ./data/exports | head -1)
ffprobe -v error -select_streams v:0 -show_entries stream=width,height,codec_name,avg_frame_rate -of default=noprint_wrappers=1 /tmp/mosaic-export.mp4
```
Expected: `codec_name=h264`, `width=1920`, `height=1080`, `avg_frame_rate=30/1` (or `30000/1001` ≈ 30).

- [ ] **Step 6: Eyeball the video**

Open `/tmp/mosaic-export.mp4` in a player. Confirm: slides match the live wall (Ken Burns pan/zoom + crossfades), **slides only** (no brand mark, counters, "Live" badge, nav, contribute, progress bar), no audio, one pass of the sequence.

- [ ] **Step 7: Verify the admin button end-to-end**

Open `http://localhost/admin#t=<ADMIN_TOKEN>` in a browser. Click **Export video**. Confirm the button shows "Exporting…" with a frame count, then a **Download video** link appears and downloads the MP4.

- [ ] **Step 8: Tear down**

Run: `docker compose down`

- [ ] **Step 9 (optional): Empty-event behavior**

With an event that has zero photos, `POST .../admin/export` should end in `{"status":"error","error":"nothing to export — this event has no photos yet"}`. Confirm the admin UI shows "Export failed: …". (Skip if the dev stack always seeds photos.)

---

## Notes for the executor

- **`/data/` serving:** photos already serve from `/data/...` (nginx serves the read-only data volume in prod; fastify-static serves it in dev), so the exports subdirectory needs no extra wiring. No nginx change is required — `?render=1` is the root path with a query string and falls through to the SPA.
- **Determinism:** `buildSequence` is deterministic for a given photo/message ordering, and the photo list is returned in a stable order, so re-running an export reproduces the same video.
- **No DB changes / no migrations.** Job state is in-memory; a mid-render API restart resets it to `idle` (accepted per spec Open Q5).
- **Output privacy:** the MP4 is reachable by anyone who knows the `/data/exports/...` URL (same posture as photos), accepted for v0.9 per spec Open Q1.
