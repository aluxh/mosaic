# Upload Safety (v0.2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Harden the upload pipeline with format detection via sharp, EXIF/metadata stripping with orientation bake-in, a 10 MB cap, and inline error display in the contribute sheet.

**Architecture:** A single new module `imageIngest.ts` owns all validation + stripping. Both the upload route and seed indexer call it. The contribute sheet catches errors thrown by `onSubmit` and renders them inline. No DB schema changes.

**Tech Stack:** TypeScript, Fastify, sharp 0.33, Vitest, React Testing Library

---

## File map

| File | Action | Purpose |
|---|---|---|
| `api/src/lib/imageIngest.ts` | Create | Validate + strip single image buffer |
| `api/src/routes/photos.ts` | Modify | Call `ingestImage`, remove inline checks |
| `api/src/lib/seedIndex.ts` | Modify | Async, call `ingestImage`, extend `IndexResult` |
| `api/src/server.ts` | Modify | `await indexSeedsForEvent`, log `skipped_reasons` |
| `api/test/imageIngest.test.ts` | Create | Unit tests for all ingest cases |
| `api/test/routes.test.ts` | Modify | Fix broken upload test + add rejection tests |
| `api/test/seedIndex.test.ts` | Modify | Fix broken tests + add ingest tests |
| `web/src/lib/api.ts` | Modify | `uploadPhoto` throws with server error message |
| `web/src/components/ContributeSheet.tsx` | Modify | Catch `onSubmit` errors, render inline |
| `web/src/test/ContributeSheet.test.tsx` | Modify | Add error display tests |

> **Note on `photos.test.ts`:** The spec references `api/test/photos.test.ts` but the photo upload tests live in `api/test/routes.test.ts`. Extend that file.

---

## Task 1: `imageIngest.ts` — core module (TDD)

**Files:**
- Create: `api/src/lib/imageIngest.ts`
- Create: `api/test/imageIngest.test.ts`

- [ ] **Step 1.1: Write failing tests**

Create `api/test/imageIngest.test.ts`:

```ts
import { describe, it, expect, beforeAll } from 'vitest';
import sharp from 'sharp';
import { ingestImage, MAX_FILE_BYTES } from '../src/lib/imageIngest.js';

// Shared fixtures — generated once before all tests
let jpegWithOrientation: Buffer; // 50×100 JPEG, EXIF orientation=6
let plainPng: Buffer;            // 1×1 PNG, no metadata
let plainWebp: Buffer;           // 1×1 WebP
let avifFixture: Buffer;         // 1×1 AVIF — sharp reports format='heif', tests the 415 path
let tiffFixture: Buffer;         // 1×1 TIFF — another rejected format
// Minimal 1×1 GIF89a (hardcoded — sharp can't output GIF)
const gifFixture = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAAHAAAAALAAAAAABAAEAAAIBRAA7', 'base64');
// SVG — XSS vector, must be rejected
const svgFixture = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"></svg>');

beforeAll(async () => {
  const base = { width: 50, height: 100, channels: 3 as const, background: { r: 200, g: 150, b: 100 } };
  jpegWithOrientation = await sharp({ create: base })
    .withMetadata({ orientation: 6 })
    .jpeg({ quality: 60 })
    .toBuffer();

  const tiny = { width: 1, height: 1, channels: 3 as const, background: 'red' };
  plainPng   = await sharp({ create: tiny }).png().toBuffer();
  plainWebp  = await sharp({ create: tiny }).webp({ quality: 60 }).toBuffer();
  avifFixture = await sharp({ create: tiny }).avif({ quality: 60 }).toBuffer();
  tiffFixture = await sharp({ create: tiny }).tiff().toBuffer();
});

describe('ingestImage', () => {
  it('accepts JPEG with EXIF orientation=6, strips metadata, bakes rotation into pixels', async () => {
    const result = await ingestImage(jpegWithOrientation, MAX_FILE_BYTES);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.format).toBe('jpeg');
    expect(result.ext).toBe('.jpg');
    const meta = await sharp(result.buf).metadata();
    expect(meta.exif).toBeUndefined();
    expect(meta.width).toBe(100);  // was 50 — orientation=6 rotates 90°
    expect(meta.height).toBe(50);  // was 100
  });

  it('accepts PNG, strips metadata, returns format=png', async () => {
    const result = await ingestImage(plainPng, MAX_FILE_BYTES);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.format).toBe('png');
    expect(result.ext).toBe('.png');
    const meta = await sharp(result.buf).metadata();
    expect(meta.exif).toBeUndefined();
  });

  it('accepts WebP, returns format=webp', async () => {
    const result = await ingestImage(plainWebp, MAX_FILE_BYTES);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.format).toBe('webp');
    expect(result.ext).toBe('.webp');
  });

  it('rejects HEIC/AVIF (format=heif) with 415', async () => {
    const result = await ingestImage(avifFixture, MAX_FILE_BYTES);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe(415);
    expect(result.error).toBe('unsupported image type — JPEG, PNG, or WebP only');
  });

  it('rejects GIF with 415', async () => {
    const result = await ingestImage(gifFixture, MAX_FILE_BYTES);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe(415);
  });

  it('rejects SVG with 415', async () => {
    const result = await ingestImage(svgFixture, MAX_FILE_BYTES);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe(415);
  });

  it('rejects TIFF with 415', async () => {
    const result = await ingestImage(tiffFixture, MAX_FILE_BYTES);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe(415);
  });

  it('rejects renamed binary with 400', async () => {
    const result = await ingestImage(Buffer.from('not an image'), MAX_FILE_BYTES);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe(400);
    expect(result.error).toBe('invalid or corrupt image');
  });

  it('rejects empty buffer with 400', async () => {
    const result = await ingestImage(Buffer.alloc(0), MAX_FILE_BYTES);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe(400);
  });

  it('rejects oversized buffer with 413', async () => {
    const big = Buffer.alloc(MAX_FILE_BYTES + 1);
    const result = await ingestImage(big, MAX_FILE_BYTES);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe(413);
    expect(result.error).toBe('file too large (max 10MB)');
  });

  it('is idempotent — running ingestImage on its own output returns byte-equal result', async () => {
    const first = await ingestImage(jpegWithOrientation, MAX_FILE_BYTES);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const second = await ingestImage(first.buf, MAX_FILE_BYTES);
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.buf).toEqual(first.buf);
  });
});
```

- [ ] **Step 1.2: Run tests to verify they fail**

```bash
cd /path/to/mosaic && npm run test:api -- --run --reporter=verbose 2>&1 | grep -A3 "imageIngest"
```

Expected: `Cannot find module '../src/lib/imageIngest.js'`

- [ ] **Step 1.3: Implement `api/src/lib/imageIngest.ts`**

```ts
import sharp from 'sharp';

export const MAX_FILE_BYTES = 10 * 1024 * 1024;

type IngestResult =
  | { ok: true; buf: Buffer; format: 'jpeg' | 'png' | 'webp'; ext: '.jpg' | '.png' | '.webp' }
  | { ok: false; code: 400 | 413 | 415; error: string };

const ALLOWED_FORMATS = new Set(['jpeg', 'png', 'webp']);

export async function ingestImage(input: Buffer, maxBytes: number): Promise<IngestResult> {
  if (input.byteLength > maxBytes) {
    return { ok: false, code: 413, error: 'file too large (max 10MB)' };
  }

  let meta: Awaited<ReturnType<sharp.Sharp['metadata']>>;
  try {
    meta = await sharp(input).metadata();
  } catch {
    return { ok: false, code: 400, error: 'invalid or corrupt image' };
  }

  if (!meta.format || !ALLOWED_FORMATS.has(meta.format)) {
    return { ok: false, code: 415, error: 'unsupported image type — JPEG, PNG, or WebP only' };
  }

  const format = meta.format as 'jpeg' | 'png' | 'webp';

  let buf: Buffer;
  if (format === 'jpeg') {
    buf = await sharp(input).rotate().jpeg({ quality: 95, mozjpeg: true }).toBuffer();
  } else if (format === 'png') {
    buf = await sharp(input).rotate().png({ compressionLevel: 9 }).toBuffer();
  } else {
    buf = await sharp(input).rotate().webp({ quality: 95 }).toBuffer();
  }

  const ext = format === 'jpeg' ? '.jpg' : format === 'png' ? '.png' : '.webp';
  return { ok: true, buf, format, ext };
}
```

- [ ] **Step 1.4: Run tests to verify they pass**

```bash
npm run test:api -- --run --reporter=verbose 2>&1 | grep -E "imageIngest|✓|✗|PASS|FAIL"
```

Expected: all 10 imageIngest tests pass.

- [ ] **Step 1.5: Commit**

```bash
git add api/src/lib/imageIngest.ts api/test/imageIngest.test.ts
git commit -m "$(cat <<'EOF'
feat(api): add imageIngest module — validate + strip image metadata

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Upload route hardening (TDD)

**Files:**
- Modify: `api/test/routes.test.ts`
- Modify: `api/src/routes/photos.ts`

The existing `uploadPng` helper sends `Buffer.alloc(size, 0x42)` which won't pass `ingestImage`. It must be replaced with real PNG bytes. Also, the existing assertion that `filename.endsWith('.png')` still holds — but the new response writes `result.buf` (a valid re-encoded PNG), so the file on disk is now a real PNG.

- [ ] **Step 2.1: Write failing tests — add to `api/test/routes.test.ts`**

At the top of the file, add the import and a `beforeAll` to generate a valid PNG buffer. Then replace the `uploadPng` helper and add new `describe` blocks.

Replace the entire `POST /api/events/:id/photos` describe block with this (keep everything else in the file unchanged):

```ts
// Add at top of file, after existing imports:
import sharp from 'sharp';

// Add before buildApp():
let minimalPng: Buffer;
let minimalJpegWithGps: Buffer; // JPEG with EXIF GPS coords

// Add a new beforeAll after the existing beforeEach:
beforeAll(async () => {
  const tiny = { width: 1, height: 1, channels: 3 as const, background: 'red' };
  minimalPng = await sharp({ create: tiny }).png().toBuffer();
  // JPEG with orientation metadata (simulates GPS JPEG — we verify EXIF is stripped post-upload)
  minimalJpegWithGps = await sharp({ create: { width: 50, height: 100, channels: 3 as const, background: 'blue' } })
    .withMetadata({ orientation: 6 })
    .jpeg({ quality: 60 })
    .toBuffer();
});
```

Replace the `describe('POST /api/events/:id/photos', ...)` block with:

```ts
describe('POST /api/events/:id/photos', () => {
  async function uploadBuffer(
    buf: Buffer,
    filename: string,
    contentType: string,
  ): Promise<ReturnType<typeof app.inject>> {
    const boundary = '----test-boundary';
    const body = Buffer.concat([
      Buffer.from(`--${boundary}\r\n`),
      Buffer.from(
        `Content-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${contentType}\r\n\r\n`,
      ),
      buf,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);
    return app.inject({
      method: 'POST',
      url: '/api/events/remembrance/photos',
      headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
      payload: body,
    });
  }

  it('writes the file to uploads dir and returns photo with URL', async () => {
    const res = await uploadBuffer(minimalPng, 'pic.png', 'image/png');
    expect(res.statusCode).toBe(201);
    const body = res.json() as { id: string; filename: string; url: string; source: string };
    expect(body.source).toBe('upload');
    expect(body.filename.endsWith('.png')).toBe(true);
    expect(body.url).toBe(`/data/uploads/remembrance/${body.filename}`);
    expect(
      fs.existsSync(path.join(paths.uploadsDir, 'remembrance', body.filename)),
    ).toBe(true);
  });

  it('accepts JPEG with EXIF, strips metadata on disk', async () => {
    const res = await uploadBuffer(minimalJpegWithGps, 'photo.jpg', 'image/jpeg');
    expect(res.statusCode).toBe(201);
    const body = res.json() as { filename: string };
    const onDisk = fs.readFileSync(path.join(paths.uploadsDir, 'remembrance', body.filename));
    const meta = await sharp(onDisk).metadata();
    expect(meta.exif).toBeUndefined();
  });

  it('rejects oversized upload with 413 and documented error string', async () => {
    const big = Buffer.alloc(10 * 1024 * 1024 + 1);
    // Fastify multipart truncates the stream — expect 413 whether from multipart limit or ingestImage
    const res = await uploadBuffer(big, 'big.jpg', 'image/jpeg');
    expect(res.statusCode).toBe(413);
  });

  it('rejects GIF with 415 and documented error string', async () => {
    const gif = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAAHAAAAALAAAAAABAAEAAAIBRAA7', 'base64');
    const res = await uploadBuffer(gif, 'anim.gif', 'image/gif');
    expect(res.statusCode).toBe(415);
    expect((res.json() as { error: string }).error).toBe(
      'unsupported image type — JPEG, PNG, or WebP only',
    );
  });

  it('rejects SVG with 415', async () => {
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"></svg>');
    const res = await uploadBuffer(svg, 'icon.svg', 'image/svg+xml');
    expect(res.statusCode).toBe(415);
  });

  it('rejects renamed binary with 400', async () => {
    const res = await uploadBuffer(Buffer.from('not an image'), 'trick.jpg', 'image/jpeg');
    expect(res.statusCode).toBe(400);
    expect((res.json() as { error: string }).error).toBe('invalid or corrupt image');
  });

  it('rejects an empty form (no file)', async () => {
    const boundary = '----test-boundary';
    const body = Buffer.from(`--${boundary}--\r\n`);
    const res = await app.inject({
      method: 'POST',
      url: '/api/events/remembrance/photos',
      headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
      payload: body,
    });
    expect(res.statusCode).toBe(400);
  });
});
```

- [ ] **Step 2.2: Run to verify existing upload test fails (ingestImage not called yet)**

```bash
npm run test:api -- --run --reporter=verbose 2>&1 | grep -A2 "writes the file\|rejects GIF\|rejects SVG\|rejects renamed"
```

Expected: "writes the file" now fails (ingestImage not yet wired), new rejection tests fail.

- [ ] **Step 2.3: Rewrite `api/src/routes/photos.ts`**

```ts
import fs from 'node:fs';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import type { DB } from '../db/index.js';
import { getEvent, insertPhoto } from '../db/queries.js';
import { newId } from '../lib/ids.js';
import { publicUrlForPhoto, uploadsDirFor, type StoragePaths } from '../lib/storage.js';
import { ingestImage, MAX_FILE_BYTES } from '../lib/imageIngest.js';

export function registerPhotoRoutes(
  app: FastifyInstance,
  db: DB,
  paths: StoragePaths,
): void {
  app.post<{ Params: { id: string } }>(
    '/api/events/:id/photos',
    async (req, reply) => {
      const event = getEvent(db, req.params.id);
      if (!event) return reply.code(404).send({ error: 'event not found' });

      const parts = req.parts();
      let fileBuf: Buffer | null = null;
      let credit = '';

      for await (const part of parts) {
        if (part.type === 'file' && part.fieldname === 'file') {
          try {
            fileBuf = await part.toBuffer();
          } catch {
            return reply.code(413).send({ error: 'file too large (max 10MB)' });
          }
        } else if (part.type === 'field' && part.fieldname === 'credit') {
          credit = String(part.value ?? '').trim();
        }
      }

      if (!fileBuf) return reply.code(400).send({ error: 'file is required' });

      const result = await ingestImage(fileBuf, MAX_FILE_BYTES);
      if (!result.ok) {
        return reply.code(result.code).send({ error: result.error });
      }

      const id = newId();
      const filename = `${id}${result.ext}`;
      const dir = uploadsDirFor(paths, req.params.id);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, filename), result.buf);

      const row = insertPhoto(db, {
        id,
        event_id: req.params.id,
        source: 'upload',
        filename,
        credit: credit || 'Guest',
        created_at: Date.now(),
      });

      return reply.code(201).send({
        ...row,
        url: publicUrlForPhoto('upload', req.params.id, filename),
      });
    },
  );
}
```

- [ ] **Step 2.4: Run tests to verify all pass**

```bash
npm run test:api -- --run --reporter=verbose 2>&1 | grep -E "POST /api.*photos|✓|✗"
```

Expected: all tests in `routes.test.ts` pass.

- [ ] **Step 2.5: Commit**

```bash
git add api/src/routes/photos.ts api/test/routes.test.ts
git commit -m "$(cat <<'EOF'
feat(api): wire ingestImage into upload route, reject by format + strip EXIF

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Seed indexer + server.ts (TDD)

**Files:**
- Modify: `api/test/seedIndex.test.ts`
- Modify: `api/src/lib/seedIndex.ts`
- Modify: `api/src/server.ts`

The existing seedIndex tests write `'x'` as file content. After this task, `ingestImage` will be called on every seed file, so those files need to be valid images or they'll appear in `skipped_reasons`. We fix existing tests by using valid image bytes.

- [ ] **Step 3.1: Rewrite `api/test/seedIndex.test.ts`**

```ts
import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { openDatabase, type DB } from '../src/db/index.js';
import { applySchemaFromString } from '../src/db/migrate.js';
import { upsertEvent, listPhotos } from '../src/db/queries.js';
import { indexSeedsForEvent } from '../src/lib/seedIndex.js';
import { makeStoragePaths, type StoragePaths } from '../src/lib/storage.js';

const SCHEMA = fs.readFileSync(
  path.resolve(__dirname, '..', 'migrations', '001_init.sql'),
  'utf8',
);

let validJpeg: Buffer;
let validPng: Buffer;
let validWebp: Buffer;

beforeAll(async () => {
  const tiny = { width: 1, height: 1, channels: 3 as const, background: 'red' };
  validJpeg = await sharp({ create: tiny }).jpeg({ quality: 60 }).toBuffer();
  validPng  = await sharp({ create: tiny }).png().toBuffer();
  validWebp = await sharp({ create: tiny }).webp({ quality: 60 }).toBuffer();
});

let tmpDir: string;
let paths: StoragePaths;
let db: DB;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mosaic-seed-'));
  paths = makeStoragePaths(tmpDir);
  fs.mkdirSync(paths.seedsDir, { recursive: true });
  db = openDatabase(':memory:');
  applySchemaFromString(db, SCHEMA);
  upsertEvent(db, {
    id: 'remembrance',
    mode: 'remembrance',
    eyebrow: 'In memory',
    title: 'X',
    dateline: 'date',
    place: 'place',
    invitation: 'invite',
    brand_sub: 'sub',
    short_code: 'X1',
  });
});

afterEach(() => {
  db.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('indexSeedsForEvent', () => {
  it('returns 0 when seeds folder is empty/missing', async () => {
    expect(await indexSeedsForEvent(db, paths, 'remembrance')).toEqual({
      inserted: 0,
      skipped: 0,
      skipped_reasons: [],
    });
  });

  it('indexes valid jpg/png/webp, skips non-image extensions', async () => {
    const dir = path.join(paths.seedsDir, 'remembrance');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'a.jpg'), validJpeg);
    fs.writeFileSync(path.join(dir, 'b.png'), validPng);
    fs.writeFileSync(path.join(dir, 'c.webp'), validWebp);
    fs.writeFileSync(path.join(dir, 'd.txt'), 'text');
    fs.writeFileSync(path.join(dir, 'e.gif'), 'gif');

    const result = await indexSeedsForEvent(db, paths, 'remembrance');
    expect(result.inserted).toBe(3);
    expect(result.skipped_reasons).toHaveLength(0);
    const filenames = listPhotos(db, 'remembrance').map((r) => r.filename).sort();
    expect(filenames).toEqual(['a.jpg', 'b.png', 'c.webp']);
  });

  it('is idempotent — second run inserts nothing new', async () => {
    const dir = path.join(paths.seedsDir, 'remembrance');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'a.jpg'), validJpeg);
    fs.writeFileSync(path.join(dir, 'b.jpg'), validJpeg);

    expect(await indexSeedsForEvent(db, paths, 'remembrance')).toMatchObject({ inserted: 2, skipped: 0 });
    expect(await indexSeedsForEvent(db, paths, 'remembrance')).toMatchObject({ inserted: 0, skipped: 2 });
    expect(listPhotos(db, 'remembrance')).toHaveLength(2);
  });

  it('records seed photos with source=seed and credit=Host', async () => {
    const dir = path.join(paths.seedsDir, 'remembrance');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'photo.jpg'), validJpeg);
    await indexSeedsForEvent(db, paths, 'remembrance');
    const [row] = listPhotos(db, 'remembrance');
    expect(row?.source).toBe('seed');
    expect(row?.credit).toBe('Host');
    expect(row?.id).toContain('seed-');
  });

  it('strips EXIF from seed JPEG and rewrites the file', async () => {
    const dir = path.join(paths.seedsDir, 'remembrance');
    fs.mkdirSync(dir, { recursive: true });
    // JPEG with orientation=6 (has EXIF)
    const jpegWithExif = await sharp({
      create: { width: 50, height: 100, channels: 3 as const, background: 'green' },
    })
      .withMetadata({ orientation: 6 })
      .jpeg({ quality: 60 })
      .toBuffer();
    const filePath = path.join(dir, 'portrait.jpg');
    fs.writeFileSync(filePath, jpegWithExif);

    await indexSeedsForEvent(db, paths, 'remembrance');

    const onDisk = fs.readFileSync(filePath);
    const meta = await sharp(onDisk).metadata();
    expect(meta.exif).toBeUndefined();
    // Orientation baked in — dimensions are swapped
    expect(meta.width).toBe(100);
    expect(meta.height).toBe(50);
  });

  it('does not re-read or rewrite already-indexed seeds on second boot', async () => {
    const dir = path.join(paths.seedsDir, 'remembrance');
    fs.mkdirSync(dir, { recursive: true });
    const filePath = path.join(dir, 'a.jpg');
    fs.writeFileSync(filePath, validJpeg);

    await indexSeedsForEvent(db, paths, 'remembrance');
    const mtimeAfterFirst = fs.statSync(filePath).mtimeMs;

    await indexSeedsForEvent(db, paths, 'remembrance');
    const mtimeAfterSecond = fs.statSync(filePath).mtimeMs;

    expect(mtimeAfterSecond).toBe(mtimeAfterFirst);
    expect(listPhotos(db, 'remembrance')).toHaveLength(1);
  });

  it('skips invalid seed file, reports reason, still indexes valid sibling', async () => {
    const dir = path.join(paths.seedsDir, 'remembrance');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'bad.jpg'), Buffer.from('not an image'));
    fs.writeFileSync(path.join(dir, 'good.jpg'), validJpeg);

    const result = await indexSeedsForEvent(db, paths, 'remembrance');

    expect(result.inserted).toBe(1);
    expect(result.skipped_reasons).toHaveLength(1);
    expect(result.skipped_reasons[0]!.filename).toBe('bad.jpg');
    expect(result.skipped_reasons[0]!.reason).toBeTruthy();
    expect(listPhotos(db, 'remembrance')).toHaveLength(1);
    expect(listPhotos(db, 'remembrance')[0]!.filename).toBe('good.jpg');
  });
});
```

- [ ] **Step 3.2: Run to verify tests fail**

```bash
npm run test:api -- --run --reporter=verbose 2>&1 | grep -E "seedIndex|✓|✗|FAIL"
```

Expected: "strips EXIF", "does not re-read", "skips invalid seed" fail. Idempotent + credit tests fail too (return shape changed).

- [ ] **Step 3.3: Rewrite `api/src/lib/seedIndex.ts`**

```ts
import fs from 'node:fs';
import path from 'node:path';
import type { DB } from '../db/index.js';
import { insertPhoto, listEvents, photoExists } from '../db/queries.js';
import { seedsDirFor, type StoragePaths } from './storage.js';
import { ingestImage, MAX_FILE_BYTES } from './imageIngest.js';

const ALLOWED_EXTS = new Set(['.jpg', '.jpeg', '.png', '.webp']);

export interface IndexResult {
  inserted: number;
  skipped: number;
  skipped_reasons: { filename: string; reason: string }[];
}

export async function indexSeedsForEvent(
  db: DB,
  paths: StoragePaths,
  eventId: string,
  now: () => number = Date.now,
): Promise<IndexResult> {
  const dir = seedsDirFor(paths, eventId);
  if (!fs.existsSync(dir)) return { inserted: 0, skipped: 0, skipped_reasons: [] };

  const files = fs
    .readdirSync(dir)
    .filter((f) => ALLOWED_EXTS.has(path.extname(f).toLowerCase()))
    .sort();

  let inserted = 0;
  let skipped = 0;
  const skipped_reasons: { filename: string; reason: string }[] = [];

  for (const filename of files) {
    const id = `seed-${eventId}-${filename}`;
    if (photoExists(db, id)) {
      skipped += 1;
      continue;
    }

    const file = path.join(dir, filename);
    const buf = fs.readFileSync(file);
    const result = await ingestImage(buf, MAX_FILE_BYTES);

    if (!result.ok) {
      skipped_reasons.push({ filename, reason: result.error });
      continue;
    }

    if (!result.buf.equals(buf)) {
      fs.writeFileSync(file, result.buf);
    }

    insertPhoto(db, {
      id,
      event_id: eventId,
      source: 'seed',
      filename,
      credit: 'Host',
      created_at: now(),
    });
    inserted += 1;
  }

  return { inserted, skipped, skipped_reasons };
}

export async function indexAllSeeds(
  db: DB,
  paths: StoragePaths,
  now: () => number = Date.now,
): Promise<Record<string, IndexResult>> {
  const out: Record<string, IndexResult> = {};
  for (const e of listEvents(db)) {
    out[e.id] = await indexSeedsForEvent(db, paths, e.id, now);
  }
  return out;
}
```

- [ ] **Step 3.4: Update `api/src/server.ts`**

Change line 34 (`indexSeedsForEvent(db, paths, event.id);`) and make `main` handle the async result:

```ts
// Replace the synchronous call:
//   indexSeedsForEvent(db, paths, event.id);
// With:
  const seedResult = await indexSeedsForEvent(db, paths, event.id);
  for (const { filename, reason } of seedResult.skipped_reasons) {
    console.warn(`[seed] skipped ${filename}: ${reason}`);
  }
```

The full updated block in `main()` becomes (lines 34–35, replacing the single `indexSeedsForEvent` line):

```ts
  const seedResult = await indexSeedsForEvent(db, paths, event.id);
  for (const { filename, reason } of seedResult.skipped_reasons) {
    console.warn(`[seed] skipped ${filename}: ${reason}`);
  }
```

> Note: The `console.warn` is intentional. The fastify `app` logger isn't yet available at this point in `main()` — the logger is created two lines later. Using `console.warn` keeps `seedIndex.ts` free of the fastify dependency as described in the spec.

- [ ] **Step 3.5: Run all API tests**

```bash
npm run test:api -- --run --reporter=verbose
```

Expected: all tests pass, including the new seed tests.

- [ ] **Step 3.6: TypeCheck**

```bash
cd api && npx tsc --noEmit
```

Expected: no errors (focus on `indexSeedsForEvent` return type change and `server.ts` await).

- [ ] **Step 3.7: Commit**

```bash
git add api/src/lib/seedIndex.ts api/src/server.ts api/test/seedIndex.test.ts
git commit -m "$(cat <<'EOF'
feat(api): async seed indexer — ingestImage, EXIF strip, skipped_reasons

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Contribute sheet error display (TDD)

**Files:**
- Modify: `web/src/lib/api.ts`
- Modify: `web/src/test/ContributeSheet.test.tsx`
- Modify: `web/src/components/ContributeSheet.tsx`

The `uploadPhoto` function currently throws `new Error('upload -> ${res.status}')`. After this task it throws with the server's error string, which `ContributeSheet` catches and renders.

- [ ] **Step 4.1: Update `web/src/lib/api.ts` — surface server error message**

Replace the current non-ok throw in `uploadPhoto` (line 94):

```ts
// Before:
  if (!res.ok) throw new Error(`upload -> ${res.status}`);

// After:
  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { error?: string };
    throw new Error(body.error ?? 'Upload failed');
  }
```

- [ ] **Step 4.2: Write new failing tests — append to `web/src/test/ContributeSheet.test.tsx`**

Add these three tests inside the existing `describe('ContributeSheet', () => { ... })` block, after the last existing test:

```ts
  it('renders server error on 413 response', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockRejectedValue(new Error('file too large (max 10MB)'));
    render(
      <ContributeSheet open={true} mode="remembrance" onClose={() => {}} onSubmit={onSubmit} />,
    );
    // Enable submit by picking a file
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(fileInput, { target: { files: [new File(['x'], 'p.jpg', { type: 'image/jpeg' })] } });
    await user.click(screen.getByRole('button', { name: /add to the remembrance/i }));
    await waitFor(() =>
      expect(screen.getByText('file too large (max 10MB)')).toBeInTheDocument(),
    );
  });

  it('renders server error on 415 response', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockRejectedValue(
      new Error('unsupported image type — JPEG, PNG, or WebP only'),
    );
    render(
      <ContributeSheet open={true} mode="remembrance" onClose={() => {}} onSubmit={onSubmit} />,
    );
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(fileInput, { target: { files: [new File(['x'], 'p.jpg', { type: 'image/jpeg' })] } });
    await user.click(screen.getByRole('button', { name: /add to the remembrance/i }));
    await waitFor(() =>
      expect(
        screen.getByText('unsupported image type — JPEG, PNG, or WebP only'),
      ).toBeInTheDocument(),
    );
  });

  it('clears error when a new file is picked', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockRejectedValue(new Error('file too large (max 10MB)'));
    render(
      <ContributeSheet open={true} mode="remembrance" onClose={() => {}} onSubmit={onSubmit} />,
    );
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(fileInput, { target: { files: [new File(['x'], 'p.jpg', { type: 'image/jpeg' })] } });
    await user.click(screen.getByRole('button', { name: /add to the remembrance/i }));
    await waitFor(() =>
      expect(screen.getByText('file too large (max 10MB)')).toBeInTheDocument(),
    );
    // Pick a new file — error should clear
    fireEvent.change(fileInput, { target: { files: [new File(['x'], 'p2.jpg', { type: 'image/jpeg' })] } });
    await waitFor(() =>
      expect(screen.queryByText('file too large (max 10MB)')).not.toBeInTheDocument(),
    );
  });
```

- [ ] **Step 4.3: Run to verify new tests fail**

```bash
npm run test:web -- --run --reporter=verbose 2>&1 | grep -E "ContributeSheet|✓|✗|FAIL"
```

Expected: the 3 new tests fail (no error state in ContributeSheet yet).

- [ ] **Step 4.4: Update `web/src/components/ContributeSheet.tsx`**

Three changes:

1. Add error state (after line 26, `const [submitting, setSubmitting] = useState(false);`):
```ts
  const [error, setError] = useState<string | null>(null);
```

2. Clear error on file pick — in `handleFile` (add `setError(null)` after `setPreview`):
```ts
  const handleFile = (f: File | null | undefined) => {
    if (!f) return;
    setFile(f);
    setPreview(URL.createObjectURL(f));
    setError(null);
  };
```

3. Catch errors in `submit` and add error reset on new attempt:
```ts
  const submit = async () => {
    if (!canSubmit) return;
    setError(null);
    setSubmitting(true);
    try {
      await onSubmit({
        name: name.trim(),
        message: message.trim(),
        file,
        previewUrl: preview,
      });
      setSuccess(true);
      await new Promise((r) => setTimeout(r, 1100));
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setSubmitting(false);
    }
  };
```

4. Also clear error in the `useEffect` reset (add `setError(null)` alongside the other resets):
```ts
  useEffect(() => {
    if (open) return;
    const t = setTimeout(() => {
      setName('');
      setMessage('');
      setFile(null);
      setPreview(null);
      setSuccess(false);
      setSubmitting(false);
      setError(null);
    }, 500);
    return () => clearTimeout(t);
  }, [open]);
```

5. Render the error under the submit button (after the `</button>` on line 242, before the "Visible on the main display" div):
```tsx
          {error && (
            <p className="upload-error mono text-[0.65rem] tracking-[0.18em] text-center text-ink-soft">
              {error}
            </p>
          )}
```

- [ ] **Step 4.5: Run all web tests**

```bash
npm run test:web -- --run --reporter=verbose
```

Expected: all tests pass, including the 3 new ContributeSheet tests.

- [ ] **Step 4.6: TypeCheck**

```bash
cd web && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4.7: Commit**

```bash
git add web/src/lib/api.ts web/src/components/ContributeSheet.tsx web/src/test/ContributeSheet.test.tsx
git commit -m "$(cat <<'EOF'
feat(web): surface server upload errors inline in ContributeSheet

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Final verification

- [ ] **Run full test suite**

```bash
cd /path/to/mosaic && npm test
```

Expected: all tests pass across both `api` and `web`.

- [ ] **TypeCheck both packages**

```bash
npm --prefix api run build 2>&1 | tail -5 && npm --prefix web run build 2>&1 | tail -5
```

Expected: clean build, no TypeScript errors.

---

## Self-review

### Spec coverage check

| Spec requirement | Task |
|---|---|
| Allowlist by format (not extension) | Task 1 — `ingestImage` uses `sharp.metadata().format` |
| Strip all metadata kinds | Task 1 — re-encode with `.rotate()` drops everything |
| Preserve display orientation | Task 1 — `.rotate()` bakes EXIF orientation into pixels |
| 10 MB cap with 413 | Task 1 + Task 2 |
| Seeds treated like uploads | Task 3 |
| Guest-facing errors | Task 4 |
| `IndexResult.skipped_reasons` | Task 3 |
| `server.ts` logs skipped seeds | Task 3 step 3.4 |

### Placeholder scan

None found.

### Type consistency check

- `ingestImage` returns `IngestResult` — used consistently in `photos.ts` and `seedIndex.ts`
- `IndexResult` extended with `skipped_reasons` — `server.ts` and tests both reference `skipped_reasons`
- `indexSeedsForEvent` returns `Promise<IndexResult>` — `server.ts` awaits it, `indexAllSeeds` awaits it
- `ContributeSheet` `error` state is `string | null` — consistent with `Error.message` and fallback

### Breaking changes to existing tests

Both are addressed in the plan:
- `routes.test.ts`: `uploadPng` helper replaced with `uploadBuffer` that takes a real PNG buffer — Task 2
- `seedIndex.test.ts`: `'x'` content replaced with `validJpeg`/`validPng`/`validWebp` — Task 3
