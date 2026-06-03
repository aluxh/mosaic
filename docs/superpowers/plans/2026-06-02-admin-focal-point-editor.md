# Admin Focal Point Editor (v0.8.1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give admins a visual modal editor to correct a photo's focal point (click/drag/keyboard a marker over the full image, preview hero/duo/polaroid crops, save) and record focal provenance so manual edits and detector fallbacks are never re-backfilled on boot.

**Architecture:** Add a `focal_source` column (`unknown|detected|fallback|manual`) to `photos`. The face detector now reports `detected`/`fallback`; upload, seed indexing, and boot backfill stamp that source. Boot backfill only touches `unknown` rows, so manual and fallback rows survive restarts. A new admin `PATCH .../focal` endpoint sets coordinates + `manual`; a `POST .../focal/recalculate` endpoint reruns detection for one file. The web admin grid opens a focused `FocalEditor` modal that reuses the existing `objectPosition` helper for live crop previews. No image files are regenerated.

**Tech Stack:** Fastify + better-sqlite3 + Vitest (api); React + Vite + Tailwind + Vitest/Testing Library (web). face-api.js + sharp for detection.

**Reference reading before starting:**
- Spec: `../mosaic-specs/v0.8.1-admin-focal-point-editor-spec.md`
- Existing focal pipeline: [api/src/lib/focalPoint.ts](../../../api/src/lib/focalPoint.ts), [api/src/lib/backfillFocalPoints.ts](../../../api/src/lib/backfillFocalPoints.ts)
- Admin routes/UI: [api/src/routes/admin.ts](../../../api/src/routes/admin.ts), [web/src/AdminApp.tsx](../../../web/src/AdminApp.tsx), [web/src/lib/adminApi.ts](../../../web/src/lib/adminApi.ts)

**Conventions (match these — do not deviate):**
- API tests build their schema by concatenating every `api/migrations/*.sql` (see top of `api/test/queries.test.ts`). A new migration file is automatically picked up.
- The detector is swapped in tests via `__setFocalPointDetectorForTest(async () => FaceBox[])` and reset in `afterEach` with `__resetFocalPointForTest()`.
- DB column names are `snake_case`; web model fields are `camelCase` (mapped in `adminApi.ts` / `api.ts`).
- Run a single api test file: `npm --prefix api run test -- --run test/<file>.test.ts`
- Run a single web test file: `npm --prefix web run test -- --run src/test/<file>.test.ts`

---

## Task 1: Migration + shared types for `focal_source`

**Files:**
- Create: `api/migrations/006_photo_focal_source.sql`
- Modify: `api/src/types.ts`
- Test: `api/test/migrate.test.ts`

- [ ] **Step 1: Write the failing migration tests**

Append these two tests inside the existing `describe('migrate', ...)` block in `api/test/migrate.test.ts` (before its closing `});`):

```ts
  it('adds photos.focal_source defaulting to unknown', () => {
    const db = openDatabase(':memory:');
    migrate(db);
    const cols = db.prepare('PRAGMA table_info(photos)').all() as {
      name: string;
      dflt_value: string | null;
    }[];
    expect(cols.find((c) => c.name === 'focal_source')?.dflt_value).toBe("'unknown'");
    db.close();
  });

  it('records 006_photo_focal_source.sql exactly once', () => {
    const db = openDatabase(':memory:');
    migrate(db);
    migrate(db);
    const n = (
      db
        .prepare("SELECT count(*) AS n FROM schema_migrations WHERE filename = '006_photo_focal_source.sql'")
        .get() as { n: number }
    ).n;
    expect(n).toBe(1);
    db.close();
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm --prefix api run test -- --run test/migrate.test.ts`
Expected: FAIL — `focal_source` column not found / migration `006...` not recorded.

- [ ] **Step 3: Create the migration**

Create `api/migrations/006_photo_focal_source.sql` with exactly:

```sql
ALTER TABLE photos
ADD COLUMN focal_source TEXT NOT NULL DEFAULT 'unknown'
CHECK (focal_source IN ('unknown', 'detected', 'fallback', 'manual'));
```

(SQLite permits a CHECK constraint on `ADD COLUMN`; existing rows take the `'unknown'` default and are not re-validated.)

- [ ] **Step 4: Add the `FocalSource` type and extend `PhotoRow`**

In `api/src/types.ts`, add the type alias after the existing `PhotoSource` line and add the field to `PhotoRow`:

```ts
export type PhotoSource = 'seed' | 'upload';
export type FocalSource = 'unknown' | 'detected' | 'fallback' | 'manual';
```

```ts
export interface PhotoRow {
  id: string;
  event_id: string;
  source: PhotoSource;
  filename: string;
  credit: string;
  created_at: number;
  hidden: number;
  focal_x: number;
  focal_y: number;
  focal_source: FocalSource;
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm --prefix api run test -- --run test/migrate.test.ts`
Expected: PASS (all migrate tests green).

- [ ] **Step 6: Commit**

```bash
git add api/migrations/006_photo_focal_source.sql api/src/types.ts api/test/migrate.test.ts
git commit -m "feat(api): add photos.focal_source column and FocalSource type"
```

---

## Task 2: Detector reports `detected` vs `fallback`

**Files:**
- Modify: `api/src/lib/focalPoint.ts`
- Test: `api/test/focalPoint.test.ts`

- [ ] **Step 1: Write the failing tests**

In `api/test/focalPoint.test.ts`, replace the existing `describe('detectFocalPoint', ...)` block with this version (adds the `source` assertions; keeps the concurrency test):

```ts
describe('detectFocalPoint', () => {
  it('reports fallback + center when the detector returns no usable faces', async () => {
    __setFocalPointDetectorForTest(async () => []);
    await expect(detectFocalPoint(await testImage())).resolves.toEqual({
      focal_x: 0.5,
      focal_y: 0.5,
      source: 'fallback',
    });
  });

  it('reports detected when the detector returns a face', async () => {
    __setFocalPointDetectorForTest(async () => [{ x: 10, y: 20, width: 30, height: 40 }]);
    await expect(detectFocalPoint(await testImage())).resolves.toEqual({
      focal_x: 0.25,
      focal_y: 0.4,
      source: 'detected',
    });
  });

  it('caps detector concurrency at two', async () => {
    let active = 0;
    let maxActive = 0;
    __setFocalPointDetectorForTest(async () => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 20));
      active -= 1;
      return [{ x: 10, y: 10, width: 20, height: 20 }];
    });

    const buf = await testImage();
    await Promise.all([detectFocalPoint(buf), detectFocalPoint(buf), detectFocalPoint(buf), detectFocalPoint(buf)]);

    expect(maxActive).toBe(2);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm --prefix api run test -- --run test/focalPoint.test.ts`
Expected: FAIL — results lack the `source` field.

- [ ] **Step 3: Implement the source-aware return type**

In `api/src/lib/focalPoint.ts`:

(a) Add the exported result interface right after the existing `FocalPoint` interface:

```ts
export interface FocalPoint {
  focal_x: number;
  focal_y: number;
}

export interface DetectedFocalPoint extends FocalPoint {
  source: 'detected' | 'fallback';
}
```

(b) Change the `queue` type and the `enqueue`/`pumpQueue` generics from `FocalPoint` to `DetectedFocalPoint`:

```ts
let modelPromise: Promise<void> | null = null;
let active = 0;
const queue: {
  run: () => Promise<DetectedFocalPoint>;
  resolve: (value: DetectedFocalPoint) => void;
  reject: (reason: unknown) => void;
}[] = [];
let detector: Detector = detectFacesWithFaceApi;
```

```ts
function enqueue(run: () => Promise<DetectedFocalPoint>): Promise<DetectedFocalPoint> {
  return new Promise((resolve, reject) => {
    queue.push({ run, resolve, reject });
    pumpQueue();
  });
}
```

(In `pumpQueue`, `job.run()` is already untyped against the queue element — no change needed beyond the queue type above.)

(c) Replace the body of `detectFocalPoint` to return a `source`:

```ts
export async function detectFocalPoint(buf: Buffer): Promise<DetectedFocalPoint> {
  return enqueue(async () => {
    const fallback: DetectedFocalPoint = { ...CENTER_FOCAL_POINT, source: 'fallback' };
    try {
      const meta = await sharp(buf).metadata();
      if (!meta.width || !meta.height) return fallback;
      const prepared = await prepareDetectionBuffer(buf);
      if (!prepared.width || !prepared.height) return fallback;
      const faces = await detector(prepared.buf);
      if (faces.length === 0) return fallback;
      return { ...focalPointFromFaces(prepared.width, prepared.height, faces), source: 'detected' };
    } catch (err) {
      console.warn(`[focal] falling back to center: ${err instanceof Error ? err.message : String(err)}`);
      return fallback;
    }
  });
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm --prefix api run test -- --run test/focalPoint.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add api/src/lib/focalPoint.ts api/test/focalPoint.test.ts
git commit -m "feat(api): detectFocalPoint reports detected vs fallback source"
```

---

## Task 3: Persist and update `focal_source` in queries

**Files:**
- Modify: `api/src/db/queries.ts`
- Test: `api/test/queries.test.ts`

- [ ] **Step 1: Write the failing tests**

In `api/test/queries.test.ts`, add a `focal_source` assertion to the existing `insertPhoto persists focal points` test and replace the `updatePhotoFocalPoint` test. Concretely:

Add to the end of the `it('insertPhoto persists focal points and defaults them to center', ...)` body (after the existing `expect` lines):

```ts
    expect(rows.find((r) => r.id === 'center')).toMatchObject({ focal_source: 'unknown' });
```

Replace the existing `it('updatePhotoFocalPoint updates only the matching event row', ...)` test with:

```ts
  it('updatePhotoFocalPoint updates coords + source only for the matching event row', () => {
    insertPhoto(db, {
      id: 'p1',
      event_id: 'remembrance',
      source: 'upload',
      filename: 'a.jpg',
      credit: 'A',
      created_at: 1,
    });
    expect(updatePhotoFocalPoint(db, 'celebration', 'p1', 0.2, 0.3, 'manual')).toBe(false);
    expect(updatePhotoFocalPoint(db, 'remembrance', 'p1', 0.2, 0.3, 'manual')).toBe(true);
    expect(listPhotos(db, 'remembrance')[0]).toMatchObject({
      focal_x: 0.2,
      focal_y: 0.3,
      focal_source: 'manual',
    });
  });

  it('insertPhoto stores an explicit focal_source', () => {
    insertPhoto(db, {
      id: 'detected',
      event_id: 'remembrance',
      source: 'seed',
      filename: 'd.jpg',
      credit: 'Host',
      created_at: 3,
      focal_x: 0.1,
      focal_y: 0.2,
      focal_source: 'detected',
    });
    expect(listPhotos(db, 'remembrance').find((r) => r.id === 'detected')).toMatchObject({
      focal_source: 'detected',
    });
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm --prefix api run test -- --run test/queries.test.ts`
Expected: FAIL — `updatePhotoFocalPoint` arity/type mismatch and missing `focal_source`.

- [ ] **Step 3: Update `InsertPhotoInput` and `insertPhoto`**

In `api/src/db/queries.ts`, import the type and extend the input + insert:

```ts
import type { EventRow, MessageRow, PhotoRow, PhotoSource, FocalSource } from '../types.js';
```

```ts
export interface InsertPhotoInput {
  id: string;
  event_id: string;
  source: PhotoSource;
  filename: string;
  credit: string;
  created_at: number;
  focal_x?: number;
  focal_y?: number;
  focal_source?: FocalSource;
}

export function insertPhoto(db: DB, p: InsertPhotoInput): PhotoRow {
  const row = {
    ...p,
    focal_x: p.focal_x ?? 0.5,
    focal_y: p.focal_y ?? 0.5,
    focal_source: p.focal_source ?? 'unknown',
  };
  db.prepare(
    `INSERT INTO photos (id, event_id, source, filename, credit, created_at, focal_x, focal_y, focal_source)
     VALUES (@id, @event_id, @source, @filename, @credit, @created_at, @focal_x, @focal_y, @focal_source)`,
  ).run(row);
  return { ...row, hidden: 0 } as PhotoRow;
}
```

- [ ] **Step 4: Add the `source` parameter to `updatePhotoFocalPoint`**

Replace the existing `updatePhotoFocalPoint` function at the bottom of `api/src/db/queries.ts`:

```ts
export function updatePhotoFocalPoint(
  db: DB,
  eventId: string,
  photoId: string,
  focal_x: number,
  focal_y: number,
  focal_source: FocalSource,
): boolean {
  const info = db
    .prepare('UPDATE photos SET focal_x = ?, focal_y = ?, focal_source = ? WHERE id = ? AND event_id = ?')
    .run(focal_x, focal_y, focal_source, photoId, eventId);
  return info.changes > 0;
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm --prefix api run test -- --run test/queries.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add api/src/db/queries.ts api/test/queries.test.ts
git commit -m "feat(api): persist focal_source on insert and focal update"
```

---

## Task 4: Boot backfill keys off `focal_source = 'unknown'`

**Files:**
- Modify: `api/src/lib/backfillFocalPoints.ts`
- Test: `api/test/backfillFocalPoints.test.ts`

- [ ] **Step 1: Write the failing tests**

Replace both tests inside `describe('backfillFocalPoints', ...)` in `api/test/backfillFocalPoints.test.ts` with:

```ts
describe('backfillFocalPoints', () => {
  it('processes only unknown rows and stamps the detected source', async () => {
    const seedDir = seedsDirFor(paths, eventId);
    fs.mkdirSync(seedDir, { recursive: true });
    fs.writeFileSync(path.join(seedDir, 'a.jpg'), await makeJpeg());
    insertPhoto(db, {
      id: 'p1',
      event_id: eventId,
      source: 'seed',
      filename: 'a.jpg',
      credit: 'Host',
      created_at: 1,
      // focal_source defaults to 'unknown'
    });

    await expect(backfillFocalPoints(db, paths, eventId)).resolves.toEqual({ updated: 1, skipped: 0 });

    expect(listAllPhotos(db, eventId)[0]).toMatchObject({
      focal_x: 0.25,
      focal_y: 0.4,
      focal_source: 'detected',
    });
  });

  it('skips manual, detected, and fallback rows and missing originals', async () => {
    insertPhoto(db, {
      id: 'manual',
      event_id: eventId,
      source: 'seed',
      filename: 'a.jpg',
      credit: 'Host',
      created_at: 1,
      focal_x: 0.2,
      focal_y: 0.3,
      focal_source: 'manual',
    });
    insertPhoto(db, {
      id: 'fallback',
      event_id: eventId,
      source: 'seed',
      filename: 'a.jpg',
      credit: 'Host',
      created_at: 2,
      focal_source: 'fallback',
    });
    insertPhoto(db, {
      id: 'missing-unknown',
      event_id: eventId,
      source: 'seed',
      filename: 'missing.jpg',
      credit: 'Host',
      created_at: 3,
    });

    await expect(backfillFocalPoints(db, paths, eventId)).resolves.toEqual({ updated: 0, skipped: 3 });
    expect(listAllPhotos(db, eventId).find((r) => r.id === 'manual')).toMatchObject({
      focal_x: 0.2,
      focal_y: 0.3,
      focal_source: 'manual',
    });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm --prefix api run test -- --run test/backfillFocalPoints.test.ts`
Expected: FAIL — backfill still skips by coordinate, not by `focal_source`.

- [ ] **Step 3: Update the backfill guard and update call**

In `api/src/lib/backfillFocalPoints.ts`, change the skip condition and the update call inside the loop:

```ts
  for (const row of listAllPhotos(db, eventId)) {
    if (row.focal_source !== 'unknown') {
      skipped += 1;
      continue;
    }

    const sourceDir = row.source === 'seed' ? seedsDirFor(paths, eventId) : uploadsDirFor(paths, eventId);
    const originalPath = path.join(sourceDir, row.filename);
    if (!fs.existsSync(originalPath)) {
      skipped += 1;
      continue;
    }

    const focal = await detectFocalPoint(fs.readFileSync(originalPath));
    if (updatePhotoFocalPoint(db, eventId, row.id, focal.focal_x, focal.focal_y, focal.source)) {
      updated += 1;
    }
  }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm --prefix api run test -- --run test/backfillFocalPoints.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add api/src/lib/backfillFocalPoints.ts api/test/backfillFocalPoints.test.ts
git commit -m "feat(api): backfill focal points only for unknown rows"
```

---

## Task 5: Upload + seed indexing stamp `focal_source`

**Files:**
- Modify: `api/src/lib/seedIndex.ts`
- Modify: `api/src/routes/photos.ts`
- Test: `api/test/seedIndex.test.ts`
- Test: `api/test/routes.test.ts`

- [ ] **Step 1: Write the failing tests**

(a) In `api/test/seedIndex.test.ts`, add this test (place it inside the existing top-level `describe(...)` for seed indexing; if the file has multiple `describe`s, add it next to the JPEG indexing tests). It seeds one file with the detector forced to return a face:

```ts
  it('stamps focal_source detected when a face is found', async () => {
    __setFocalPointDetectorForTest(async () => [{ x: 10, y: 20, width: 30, height: 40 }]);
    const seedDir = paths.seedsDir + '/remembrance';
    fs.mkdirSync(seedDir, { recursive: true });
    fs.writeFileSync(path.join(seedDir, 'face.jpg'), validJpeg);

    await indexSeedsForEvent(db, paths, 'remembrance');

    expect(listPhotos(db, 'remembrance').find((p) => p.filename === 'face.jpg')).toMatchObject({
      focal_source: 'detected',
    });
    __resetFocalPointForTest();
  });
```

> Note: if `seedsDirFor` is already imported in this test file, prefer `seedsDirFor(paths, 'remembrance')` over the string concat above to match the file's style. Check the imports at the top of the file first.

(b) In `api/test/routes.test.ts`, extend the upload-success assertion. Find the `POST /api/events/:id/photos` success test that asserts `toMatchObject({ focal_x: 0.5, focal_y: 0.5 })` (around the body-decode block) and add `focal_source: 'fallback'` to that same `toMatchObject` (the suite's `beforeEach` sets the detector to `async () => []`, i.e. no faces):

```ts
    expect(body).toMatchObject({ focal_x: 0.5, focal_y: 0.5, focal_source: 'fallback' });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm --prefix api run test -- --run test/seedIndex.test.ts test/routes.test.ts`
Expected: FAIL — `focal_source` is `'unknown'` (spread of `...focal` only carried coords; `source` was dropped because the column key is `focal_source`).

- [ ] **Step 3: Map the detector source in seed indexing**

In `api/src/lib/seedIndex.ts`, replace the detect+insert block:

```ts
    const focal = await detectFocalPoint(result.buf);
    insertPhoto(db, {
      id: `seed-${eventId}-${storedName}`,
      event_id: eventId,
      source: 'seed',
      filename: storedName,
      credit: 'Host',
      created_at: now(),
      focal_x: focal.focal_x,
      focal_y: focal.focal_y,
      focal_source: focal.source,
    });
```

- [ ] **Step 4: Map the detector source in the upload route**

In `api/src/routes/photos.ts`, replace the `insertPhoto` call inside `writePair`:

```ts
        const photo = insertPhoto(db, {
          id,
          event_id: eventId,
          source: 'upload',
          filename,
          credit: credit || 'Guest',
          created_at: createdAt,
          focal_x: focal.focal_x,
          focal_y: focal.focal_y,
          focal_source: focal.source,
        });
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm --prefix api run test -- --run test/seedIndex.test.ts test/routes.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add api/src/lib/seedIndex.ts api/src/routes/photos.ts api/test/seedIndex.test.ts api/test/routes.test.ts
git commit -m "feat(api): stamp focal_source on upload and seed indexing"
```

---

## Task 6: Admin focal endpoints (`PATCH .../focal`, `POST .../focal/recalculate`) + list field

**Files:**
- Modify: `api/src/routes/admin.ts`
- Test: `api/test/routes.test.ts`

- [ ] **Step 1: Write the failing tests**

In `api/test/routes.test.ts`, add these tests at the end of the `describe('admin routes', ...)` block (the `seedUploadPhoto` helper and `adminAuth()` are already in scope). Note: `seedUploadPhoto` inserts with no `focal_source`, so rows default to `'unknown'`.

```ts
  it('GET admin/photos includes focal_source', async () => {
    await seedUploadPhoto('fs1');
    const res = await app.inject({ method: 'GET', url: '/api/events/remembrance/admin/photos', headers: { authorization: adminAuth() } });
    const body = res.json() as Array<{ id: string; focal_source: string }>;
    expect(body.find((p) => p.id === 'fs1')).toMatchObject({ focal_source: 'unknown' });
  });

  it('PATCH admin/photos/:id/focal validates, sets manual, and 404s for missing', async () => {
    await seedUploadPhoto('fc1');

    const ok = await app.inject({
      method: 'PATCH',
      url: '/api/events/remembrance/admin/photos/fc1/focal',
      payload: { focal_x: 0.42, focal_y: 0.31 },
      headers: { authorization: adminAuth() },
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toEqual({ ok: true });

    const list = await app.inject({ method: 'GET', url: '/api/events/remembrance/admin/photos', headers: { authorization: adminAuth() } });
    expect((list.json() as Array<{ id: string; focal_x: number; focal_y: number; focal_source: string }>).find((p) => p.id === 'fc1'))
      .toMatchObject({ focal_x: 0.42, focal_y: 0.31, focal_source: 'manual' });

    for (const payload of [{ focal_x: 1.2, focal_y: 0.5 }, { focal_x: -0.1, focal_y: 0.5 }, { focal_x: 'x', focal_y: 0.5 }, { focal_y: 0.5 }]) {
      const bad = await app.inject({ method: 'PATCH', url: '/api/events/remembrance/admin/photos/fc1/focal', payload, headers: { authorization: adminAuth() } });
      expect(bad.statusCode, JSON.stringify(payload)).toBe(400);
    }

    const missing = await app.inject({
      method: 'PATCH',
      url: '/api/events/remembrance/admin/photos/nope/focal',
      payload: { focal_x: 0.5, focal_y: 0.5 },
      headers: { authorization: adminAuth() },
    });
    expect(missing.statusCode).toBe(404);
  });

  it('PATCH admin/photos/:id/focal requires admin (401 for guest/no token)', async () => {
    await seedUploadPhoto('fc2');
    const payload = { focal_x: 0.5, focal_y: 0.5 };
    const url = '/api/events/remembrance/admin/photos/fc2/focal';
    expect((await app.inject({ method: 'PATCH', url, payload })).statusCode).toBe(401);
    expect((await app.inject({ method: 'PATCH', url, payload, headers: { authorization: validAuth() } })).statusCode).toBe(401);
  });

  it('POST admin/photos/:id/focal/recalculate reruns detection and stores the source', async () => {
    await seedUploadPhoto('rc1');
    __setFocalPointDetectorForTest(async () => [{ x: 10, y: 20, width: 30, height: 40 }]);

    const res = await app.inject({
      method: 'POST',
      url: '/api/events/remembrance/admin/photos/rc1/focal/recalculate',
      headers: { authorization: adminAuth() },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ ok: true, focal_source: 'detected' });

    const list = await app.inject({ method: 'GET', url: '/api/events/remembrance/admin/photos', headers: { authorization: adminAuth() } });
    expect((list.json() as Array<{ id: string; focal_source: string }>).find((p) => p.id === 'rc1'))
      .toMatchObject({ focal_source: 'detected' });
  });

  it('POST admin/photos/:id/focal/recalculate 404s for a missing photo', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/events/remembrance/admin/photos/nope/focal/recalculate',
      headers: { authorization: adminAuth() },
    });
    expect(res.statusCode).toBe(404);
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm --prefix api run test -- --run test/routes.test.ts`
Expected: FAIL — the `/focal` and `/focal/recalculate` routes 404 (not registered).

- [ ] **Step 3: Add imports and a validation helper to `admin.ts`**

In `api/src/routes/admin.ts`, extend the queries import and add the focal-point detector import:

```ts
import {
  getEvent,
  listAdminPhotos,
  setPhotoHidden,
  deletePhotoCascade,
  updateTransitionStyle,
  listAdminMessages,
  setMessageHidden,
  deleteMessage,
  getPhotoForEvent,
  updatePhotoFocalPoint,
} from '../db/queries.js';
import { detectFocalPoint } from '../lib/focalPoint.js';
```

Add this helper above `registerAdminRoutes` (next to `VALID_STYLES`):

```ts
function isUnitNumber(n: unknown): n is number {
  return typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 1;
}
```

- [ ] **Step 4: Register the focal endpoints**

In `api/src/routes/admin.ts`, add both routes inside `registerAdminRoutes` immediately after the existing `PATCH /api/events/:id/admin/photos/:photoId` (visibility) route:

```ts
  app.patch<{ Params: { id: string; photoId: string }; Body: { focal_x?: unknown; focal_y?: unknown } }>(
    '/api/events/:id/admin/photos/:photoId/focal',
    { preHandler: requireAdmin },
    async (req, reply) => {
      const { focal_x, focal_y } = req.body ?? {};
      if (!isUnitNumber(focal_x) || !isUnitNumber(focal_y)) {
        return reply.code(400).send({ error: 'focal_x and focal_y must be numbers in 0..1' });
      }
      const updated = updatePhotoFocalPoint(db, req.params.id, req.params.photoId, focal_x, focal_y, 'manual');
      if (!updated) return reply.code(404).send({ error: 'photo not found' });
      liveUpdates?.publish({ type: 'photo_updated', eventId: req.params.id, createdAt: Date.now() });
      return { ok: true };
    },
  );

  app.post<{ Params: { id: string; photoId: string } }>(
    '/api/events/:id/admin/photos/:photoId/focal/recalculate',
    { preHandler: requireAdmin },
    async (req, reply) => {
      const row = getPhotoForEvent(db, req.params.id, req.params.photoId);
      if (!row) return reply.code(404).send({ error: 'photo not found' });
      const sourceDir = row.source === 'seed' ? seedsDirFor(paths, req.params.id) : uploadsDirFor(paths, req.params.id);
      const originalPath = path.join(sourceDir, safeFilename(row.filename));
      if (!fs.existsSync(originalPath)) return reply.code(404).send({ error: 'original not found' });
      const focal = await detectFocalPoint(fs.readFileSync(originalPath));
      updatePhotoFocalPoint(db, req.params.id, req.params.photoId, focal.focal_x, focal.focal_y, focal.source);
      liveUpdates?.publish({ type: 'photo_updated', eventId: req.params.id, createdAt: Date.now() });
      return { ok: true, focal_x: focal.focal_x, focal_y: focal.focal_y, focal_source: focal.source };
    },
  );
```

(`fs`, `path`, `safeFilename`, `seedsDirFor`, `uploadsDirFor` are already imported at the top of `admin.ts`. The admin photo list route already spreads `...p`, so `focal_source` flows through automatically once `PhotoRow` carries it — no change needed there.)

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm --prefix api run test -- --run test/routes.test.ts`
Expected: PASS.

- [ ] **Step 6: Run the full api suite + typecheck**

Run: `npm --prefix api run test -- --run`
Run: `npm --prefix api run typecheck`
Expected: PASS / no type errors.

- [ ] **Step 7: Commit**

```bash
git add api/src/routes/admin.ts api/test/routes.test.ts
git commit -m "feat(api): admin focal update and recalculate endpoints"
```

---

## Task 7: Harden the public photo response (least-exposure allowlist)

**Files:**
- Modify: `api/src/routes/events.ts`
- Test: `api/test/routes.test.ts`

**Why:** The public `GET /api/events/:id/photos` spreads the full DB row (`...p`), so every `photos` column — now including `focal_source`, plus the internal `filename` and `hidden` — is emitted to unauthenticated clients. This is not a vulnerability (the values are non-sensitive and not attacker-controlled; `focal_source` is a `CHECK`-constrained enum), but the spread makes every new column public-by-default. Switch the public response to an explicit allowlist so operational metadata stays server-side and future columns don't leak silently. The public web mapper (`web/src/lib/api.ts` `toPhoto`) only consumes `id, event_id, source, credit, created_at, focal_x, focal_y` + the three URLs, so **no web change is needed**.

**Scope note (deliberate):** This task covers only the unauthenticated public list. The upload `201` response (`POST .../photos`) is token-gated and returns the caller's own row — left unchanged. `GET /api/events` returning full event rows is a pre-existing, unrelated concern — out of scope. The admin list (`GET .../admin/photos`) intentionally keeps `focal_source` (it is the authorized surface the editor reads).

- [ ] **Step 1: Write the failing test**

In `api/test/routes.test.ts`, add this self-contained test inside the existing `describe('GET /api/events/:id/photos', ...)` block (it seeds its own photo, mirroring the `returns seed photos` test; `jpegWithExif`, `indexSeedsForEvent`, `fs`, `path`, `paths` are all already in scope):

```ts
  it('omits operational columns (focal_source, filename, hidden) from the public payload', async () => {
    const dir = path.join(paths.seedsDir, 'remembrance');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'pub.jpg'), jpegWithExif);
    await indexSeedsForEvent(db, paths, 'remembrance');

    const res = await app.inject({ method: 'GET', url: '/api/events/remembrance/photos' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as Array<Record<string, unknown>>;
    expect(body).toHaveLength(1);
    expect(body[0]).not.toHaveProperty('focal_source');
    expect(body[0]).not.toHaveProperty('filename');
    expect(body[0]).not.toHaveProperty('hidden');
    // still carries what the wall needs:
    expect(body[0]).toMatchObject({ source: 'seed', focal_x: 0.5, focal_y: 0.5 });
    expect(body[0]).toHaveProperty('url');
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm --prefix api run test -- --run test/routes.test.ts`
Expected: FAIL — `focal_source` (and `filename`/`hidden`) are present in the payload.

- [ ] **Step 3: Add an explicit public mapper**

In `api/src/routes/events.ts`, import `PhotoRow`, add a `toPublicPhoto` helper, and use it in the photos route. Full new file:

```ts
import type { FastifyInstance } from 'fastify';
import type { DB } from '../db/index.js';
import { getEvent, listEvents, listMessages, listPhotos } from '../db/queries.js';
import { publicUrlForPhoto, publicUrlForVariant } from '../lib/storage.js';
import type { PhotoRow } from '../types.js';

function toPublicPhoto(p: PhotoRow) {
  return {
    id: p.id,
    event_id: p.event_id,
    source: p.source,
    credit: p.credit,
    created_at: p.created_at,
    focal_x: p.focal_x,
    focal_y: p.focal_y,
    url: publicUrlForPhoto(p.source, p.event_id, p.filename),
    url_1024: publicUrlForVariant(p.event_id, p.filename, 1024),
    url_320: publicUrlForVariant(p.event_id, p.filename, 320),
  };
}

export function registerEventRoutes(app: FastifyInstance, db: DB): void {
  app.get('/api/events', async () => listEvents(db));

  app.get<{ Params: { id: string } }>(
    '/api/events/:id/photos',
    async (req, reply) => {
      const event = getEvent(db, req.params.id);
      if (!event) return reply.code(404).send({ error: 'event not found' });
      return listPhotos(db, req.params.id).map(toPublicPhoto);
    },
  );

  app.get<{ Params: { id: string } }>('/api/events/:id/messages', async (req, reply) => {
    const event = getEvent(db, req.params.id);
    if (!event) return reply.code(404).send({ error: 'event not found' });
    return listMessages(db, req.params.id);
  });
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm --prefix api run test -- --run test/routes.test.ts`
Expected: PASS — including the existing `returns seed photos with resolved URLs` test (it only asserts allowlisted fields).

- [ ] **Step 5: Typecheck**

Run: `npm --prefix api run typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add api/src/routes/events.ts api/test/routes.test.ts
git commit -m "refactor(api): allowlist public photo response, drop operational columns"
```

---

## Task 8: Web focal helpers (`clamp01`, `focalFromPoint`)

**Files:**
- Modify: `web/src/lib/focalPoint.ts`
- Test: `web/src/test/focalPoint.test.ts` (new)

- [ ] **Step 1: Write the failing test**

Create `web/src/test/focalPoint.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { clamp01, focalFromPoint, objectPositionForPhoto } from '../lib/focalPoint';

describe('clamp01', () => {
  it('clamps to the 0..1 range and defaults non-finite to 0.5', () => {
    expect(clamp01(-0.4)).toBe(0);
    expect(clamp01(1.4)).toBe(1);
    expect(clamp01(0.3)).toBe(0.3);
    expect(clamp01(Number.NaN)).toBe(0.5);
  });
});

describe('focalFromPoint', () => {
  const rect = { left: 100, top: 50, width: 200, height: 400 };

  it('converts a pointer position inside the rect to a 0..1 focal point', () => {
    expect(focalFromPoint(rect, 150, 250)).toEqual({ x: 0.25, y: 0.5 });
  });

  it('clamps points outside the rect to the image bounds', () => {
    expect(focalFromPoint(rect, 0, 1000)).toEqual({ x: 0, y: 1 });
    expect(focalFromPoint(rect, 9999, 0)).toEqual({ x: 1, y: 0 });
  });

  it('returns center for a zero-size rect', () => {
    expect(focalFromPoint({ left: 0, top: 0, width: 0, height: 0 }, 10, 10)).toEqual({ x: 0.5, y: 0.5 });
  });
});

describe('objectPositionForPhoto', () => {
  it('formats focal coordinates as a percentage object-position', () => {
    expect(objectPositionForPhoto({ focalX: 0.25, focalY: 0.5 })).toBe('25% 50%');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm --prefix web run test -- --run src/test/focalPoint.test.ts`
Expected: FAIL — `clamp01` and `focalFromPoint` are not exported.

- [ ] **Step 3: Add the helpers**

Replace the contents of `web/src/lib/focalPoint.ts` with:

```ts
import type { Photo } from '../types';

export function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0.5;
  return Math.min(1, Math.max(0, n));
}

export function focalFromPoint(
  rect: { left: number; top: number; width: number; height: number },
  clientX: number,
  clientY: number,
): { x: number; y: number } {
  const x = rect.width > 0 ? (clientX - rect.left) / rect.width : 0.5;
  const y = rect.height > 0 ? (clientY - rect.top) / rect.height : 0.5;
  return { x: clamp01(x), y: clamp01(y) };
}

export function objectPositionForPhoto(photo: Pick<Photo, 'focalX' | 'focalY'>): string {
  return `${Math.round(clamp01(photo.focalX) * 100)}% ${Math.round(clamp01(photo.focalY) * 100)}%`;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm --prefix web run test -- --run src/test/focalPoint.test.ts`
Expected: PASS.

- [ ] **Step 5: Confirm no regression in existing object-position usage**

Run: `npm --prefix web run test -- --run src/test/slideVariants.test.tsx`
Expected: PASS (the `objectPositionForPhoto` output format is unchanged).

- [ ] **Step 6: Commit**

```bash
git add web/src/lib/focalPoint.ts web/src/test/focalPoint.test.ts
git commit -m "feat(web): add clamp01 and focalFromPoint focal helpers"
```

---

## Task 9: Web types + adminApi focal methods

**Files:**
- Modify: `web/src/types.ts`
- Modify: `web/src/lib/adminApi.ts`
- Test: `web/src/test/adminApi.test.ts`

- [ ] **Step 1: Write the failing tests**

In `web/src/test/adminApi.test.ts`:

(a) Update the import line to add the new functions:

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
} from '../lib/adminApi';
```

(b) Extend the `fetchAdminPhotos` mapping assertion — change the mocked row and expectation in the existing `'fetchAdminPhotos sends the bearer token and maps rows'` test to include `focal_source`:

```ts
    const fn = mockFetch(() => ({
      ok: true,
      json: async () => [{ id: 'p1', event_id: 'e1', source: 'seed', url: '/u', url_1024: '/a', url_320: '/b', credit: 'C', created_at: 1, hidden: 1, focal_x: 0.3, focal_y: 0.7, focal_source: 'manual' }],
    }));
    const photos = await fetchAdminPhotos('e1', 'tok');
    expect(fn).toHaveBeenCalledWith('/api/events/e1/admin/photos', expect.objectContaining({
      headers: { Authorization: 'Bearer tok' },
    }));
    expect(photos[0]).toMatchObject({ id: 'p1', hidden: true, source: 'seed', url320: '/b', focalX: 0.3, focalY: 0.7, focalSource: 'manual' });
```

(c) Add new tests at the end of the `describe('adminApi', ...)` block:

```ts
  it('defaults a missing focal_source to unknown', async () => {
    mockFetch(() => ({
      ok: true,
      json: async () => [{ id: 'p1', event_id: 'e1', source: 'seed', url: '/u', url_1024: '/a', url_320: '/b', credit: 'C', created_at: 1, hidden: 0, focal_x: 0.5, focal_y: 0.5 }],
    }));
    const photos = await fetchAdminPhotos('e1', 'tok');
    expect(photos[0]?.focalSource).toBe('unknown');
  });

  it('updatePhotoFocal PATCHes normalized coordinates', async () => {
    const fn = mockFetch(() => ({ ok: true, json: async () => ({ ok: true }) }));
    await updatePhotoFocal('e1', 'p1', 0.42, 0.31, 'tok');
    expect(fn).toHaveBeenCalledWith('/api/events/e1/admin/photos/p1/focal', expect.objectContaining({
      method: 'PATCH',
      body: JSON.stringify({ focal_x: 0.42, focal_y: 0.31 }),
    }));
  });

  it('recalculatePhotoFocal POSTs and maps the response', async () => {
    const fn = mockFetch(() => ({ ok: true, json: async () => ({ ok: true, focal_x: 0.2, focal_y: 0.4, focal_source: 'detected' }) }));
    const result = await recalculatePhotoFocal('e1', 'p1', 'tok');
    expect(fn).toHaveBeenCalledWith('/api/events/e1/admin/photos/p1/focal/recalculate', expect.objectContaining({ method: 'POST' }));
    expect(result).toEqual({ focalX: 0.2, focalY: 0.4, focalSource: 'detected' });
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm --prefix web run test -- --run src/test/adminApi.test.ts`
Expected: FAIL — `updatePhotoFocal` / `recalculatePhotoFocal` not exported; `focalSource` missing from mapping.

- [ ] **Step 3: Add `FocalSource` + `focalSource` to web types**

In `web/src/types.ts`, add the type alias after `TransitionStyle` and the field to `AdminPhoto`:

```ts
export type TransitionStyle = 'default' | 'cinematic';
export type FocalSource = 'unknown' | 'detected' | 'fallback' | 'manual';
```

```ts
export interface AdminPhoto extends Photo {
  hidden: boolean;
  focalSource: FocalSource;
}
```

- [ ] **Step 4: Map `focal_source` and add the two API calls**

In `web/src/lib/adminApi.ts`:

(a) Import `FocalSource` and extend `ApiAdminPhoto` + `toAdminPhoto`:

```ts
import type { AdminMessage, AdminPhoto, FocalSource, TransitionStyle } from '../types';
```

```ts
interface ApiAdminPhoto {
  id: string;
  event_id: string;
  source: AdminPhoto['source'];
  url: string;
  url_1024: string;
  url_320: string;
  credit: string;
  created_at: number;
  hidden: number;
  focal_x?: number;
  focal_y?: number;
  focal_source?: FocalSource;
}

const toAdminPhoto = (p: ApiAdminPhoto): AdminPhoto => ({
  id: p.id,
  eventId: p.event_id,
  source: p.source,
  url: p.url,
  url1024: p.url_1024,
  url320: p.url_320,
  credit: p.credit,
  createdAt: p.created_at,
  hidden: p.hidden === 1,
  focalX: p.focal_x ?? 0.5,
  focalY: p.focal_y ?? 0.5,
  focalSource: p.focal_source ?? 'unknown',
});
```

(b) Add these two functions after `setPhotoHidden`:

```ts
export async function updatePhotoFocal(
  eventId: string,
  photoId: string,
  focalX: number,
  focalY: number,
  token: string,
): Promise<void> {
  const url = `/api/events/${eventId}/admin/photos/${photoId}/focal`;
  await ensureOk(await fetch(url, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json', ...authHeaders(token) },
    body: JSON.stringify({ focal_x: focalX, focal_y: focalY }),
  }), url);
}

export async function recalculatePhotoFocal(
  eventId: string,
  photoId: string,
  token: string,
): Promise<{ focalX: number; focalY: number; focalSource: FocalSource }> {
  const url = `/api/events/${eventId}/admin/photos/${photoId}/focal/recalculate`;
  const res = await ensureOk(await fetch(url, { method: 'POST', headers: authHeaders(token) }), url);
  const data = (await res.json()) as { focal_x: number; focal_y: number; focal_source: FocalSource };
  return { focalX: data.focal_x, focalY: data.focal_y, focalSource: data.focal_source };
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm --prefix web run test -- --run src/test/adminApi.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add web/src/types.ts web/src/lib/adminApi.ts web/src/test/adminApi.test.ts
git commit -m "feat(web): map focalSource and add focal update/recalculate api calls"
```

---

## Task 10: `FocalEditor` modal component

**Files:**
- Create: `web/src/components/FocalEditor.tsx`
- Test: `web/src/test/FocalEditor.test.tsx` (new)

- [ ] **Step 1: Write the failing tests**

Create `web/src/test/FocalEditor.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { FocalEditor } from '../components/FocalEditor';
import type { AdminPhoto } from '../types';

const photo: AdminPhoto = {
  id: 'p1', eventId: 'e1', source: 'seed', url: '/p1.jpg', url1024: '/p1-1024.jpg',
  url320: '/p1-320.jpg', credit: 'C', createdAt: 0, hidden: false, focalX: 0.5, focalY: 0.5,
  focalSource: 'detected',
};

beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
    left: 0, top: 0, width: 100, height: 100, right: 100, bottom: 100, x: 0, y: 0, toJSON: () => ({}),
  } as DOMRect);
});

afterEach(() => vi.restoreAllMocks());

function noop() { return Promise.resolve(); }
function noRecalc() { return Promise.resolve({ focalX: 0.5, focalY: 0.5 }); }

describe('FocalEditor', () => {
  it('renders the marker at the current focal point', () => {
    render(<FocalEditor photo={photo} onSave={noop} onRecalculate={noRecalc} onClose={() => {}} />);
    const marker = screen.getByRole('slider', { name: /focal point/i });
    expect(marker.style.left).toBe('50%');
    expect(marker.style.top).toBe('50%');
  });

  it('clicking the image moves the marker and updates the preview object-position', () => {
    render(<FocalEditor photo={photo} onSave={noop} onRecalculate={noRecalc} onClose={() => {}} />);
    fireEvent.pointerDown(screen.getByTestId('focal-image'), { clientX: 25, clientY: 75 });
    expect(screen.getByRole('slider').style.left).toBe('25%');
    expect(screen.getByRole('slider').style.top).toBe('75%');
    const previews = screen.getAllByTestId('focal-preview');
    expect(previews[0]!.style.objectPosition).toBe('25% 75%');
  });

  it('Save calls onSave with the current coordinates then closes', async () => {
    const onSave = vi.fn(noop);
    const onClose = vi.fn();
    render(<FocalEditor photo={photo} onSave={onSave} onRecalculate={noRecalc} onClose={onClose} />);
    fireEvent.pointerDown(screen.getByTestId('focal-image'), { clientX: 10, clientY: 20 });
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }));
    await waitFor(() => expect(onSave).toHaveBeenCalledWith(0.1, 0.2));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it('Cancel closes without saving', () => {
    const onSave = vi.fn(noop);
    const onClose = vi.fn();
    render(<FocalEditor photo={photo} onSave={onSave} onRecalculate={noRecalc} onClose={onClose} />);
    fireEvent.pointerDown(screen.getByTestId('focal-image'), { clientX: 10, clientY: 20 });
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));
    expect(onSave).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it('Reset to center moves the marker to 50% 50%', () => {
    render(<FocalEditor photo={photo} onSave={noop} onRecalculate={noRecalc} onClose={() => {}} />);
    fireEvent.pointerDown(screen.getByTestId('focal-image'), { clientX: 10, clientY: 10 });
    fireEvent.click(screen.getByRole('button', { name: /reset to center/i }));
    expect(screen.getByRole('slider').style.left).toBe('50%');
    expect(screen.getByRole('slider').style.top).toBe('50%');
  });

  it('arrow keys nudge the marker and clamp at the image edge', () => {
    render(<FocalEditor photo={photo} onSave={noop} onRecalculate={noRecalc} onClose={() => {}} />);
    const marker = screen.getByRole('slider');
    for (let i = 0; i < 60; i += 1) fireEvent.keyDown(marker, { key: 'ArrowRight' });
    expect(marker.style.left).toBe('100%'); // clamped, never exceeds bounds
    for (let i = 0; i < 60; i += 1) fireEvent.keyDown(marker, { key: 'ArrowUp' });
    expect(marker.style.top).toBe('0%');
  });

  it('Recalculate updates the marker from the detector result', async () => {
    const onRecalculate = vi.fn(async () => ({ focalX: 0.2, focalY: 0.8 }));
    render(<FocalEditor photo={photo} onSave={noop} onRecalculate={onRecalculate} onClose={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /recalculate/i }));
    await waitFor(() => expect(screen.getByRole('slider').style.left).toBe('20%'));
    expect(screen.getByRole('slider').style.top).toBe('80%');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm --prefix web run test -- --run src/test/FocalEditor.test.tsx`
Expected: FAIL — `web/src/components/FocalEditor.tsx` does not exist.

- [ ] **Step 3: Implement the component**

Create `web/src/components/FocalEditor.tsx`:

```tsx
import { useRef, useState } from 'react';
import type { AdminPhoto } from '../types';
import { clamp01, focalFromPoint, objectPositionForPhoto } from '../lib/focalPoint';

interface FocalEditorProps {
  photo: AdminPhoto;
  onSave: (focalX: number, focalY: number) => Promise<void>;
  onRecalculate: () => Promise<{ focalX: number; focalY: number }>;
  onClose: () => void;
}

const STEP = 0.02;

const PREVIEWS: { label: string; className: string }[] = [
  { label: 'Hero', className: 'aspect-video' },
  { label: 'Duo', className: 'aspect-[3/2]' },
  { label: 'Polaroid', className: 'aspect-[3/4]' },
];

const ARROWS: Record<string, [number, number]> = {
  ArrowLeft: [-STEP, 0],
  ArrowRight: [STEP, 0],
  ArrowUp: [0, -STEP],
  ArrowDown: [0, STEP],
};

export function FocalEditor({ photo, onSave, onRecalculate, onClose }: FocalEditorProps) {
  const [focalX, setFocalX] = useState(photo.focalX);
  const [focalY, setFocalY] = useState(photo.focalY);
  const [busy, setBusy] = useState(false);
  const dragging = useRef(false);
  const imageRef = useRef<HTMLDivElement>(null);

  const moveTo = (clientX: number, clientY: number) => {
    const el = imageRef.current;
    if (!el) return;
    const { x, y } = focalFromPoint(el.getBoundingClientRect(), clientX, clientY);
    setFocalX(x);
    setFocalY(y);
  };

  const onPointerDown = (e: React.PointerEvent) => {
    dragging.current = true;
    (e.target as Element).setPointerCapture?.(e.pointerId);
    moveTo(e.clientX, e.clientY);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (dragging.current) moveTo(e.clientX, e.clientY);
  };
  const onPointerUp = () => {
    dragging.current = false;
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    const delta = ARROWS[e.key];
    if (!delta) return;
    e.preventDefault();
    setFocalX((x) => clamp01(x + delta[0]));
    setFocalY((y) => clamp01(y + delta[1]));
  };

  const livePosition = objectPositionForPhoto({ focalX, focalY });

  const save = async () => {
    setBusy(true);
    try {
      await onSave(focalX, focalY);
      onClose();
    } finally {
      setBusy(false);
    }
  };

  const recalc = async () => {
    setBusy(true);
    try {
      const r = await onRecalculate();
      setFocalX(r.focalX);
      setFocalY(r.focalY);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4" role="dialog" aria-label="Edit focal point">
      <div className="flex max-h-full w-full max-w-4xl flex-col gap-4 overflow-auto rounded-xl border border-neutral-800 bg-neutral-950 p-4 sm:flex-row">
        <div className="flex-1">
          <div
            ref={imageRef}
            data-testid="focal-image"
            className="relative w-full touch-none select-none overflow-hidden rounded-lg bg-neutral-900"
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
          >
            <img src={photo.url1024} alt={photo.id} className="block w-full" draggable={false} />
            <div
              role="slider"
              tabIndex={0}
              aria-label="Focal point"
              aria-valuetext={livePosition}
              onKeyDown={onKeyDown}
              className="absolute h-6 w-6 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-black/40 shadow"
              style={{ left: `${focalX * 100}%`, top: `${focalY * 100}%` }}
            />
          </div>
        </div>

        <div className="flex w-full flex-col gap-3 sm:w-56">
          {PREVIEWS.map((p) => (
            <div key={p.label}>
              <p className="mono mb-1 text-[0.6rem] uppercase tracking-wide text-neutral-400">{p.label}</p>
              <div className={`${p.className} w-full overflow-hidden rounded bg-neutral-900`}>
                <img
                  data-testid="focal-preview"
                  src={photo.url1024}
                  alt=""
                  className="h-full w-full object-cover"
                  style={{ objectPosition: livePosition }}
                />
              </div>
            </div>
          ))}

          <div className="mt-auto flex flex-col gap-2">
            <button
              type="button"
              onClick={() => {
                setFocalX(0.5);
                setFocalY(0.5);
              }}
              className="rounded border border-neutral-700 py-2 text-xs mono"
            >
              Reset to center
            </button>
            <button type="button" onClick={recalc} disabled={busy} className="rounded border border-neutral-700 py-2 text-xs mono">
              Recalculate
            </button>
            <div className="flex gap-2">
              <button type="button" onClick={onClose} className="flex-1 rounded border border-neutral-700 py-2 text-xs mono">
                Cancel
              </button>
              <button type="button" onClick={save} disabled={busy} className="flex-1 rounded bg-neutral-100 py-2 text-xs mono text-neutral-900">
                Save
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm --prefix web run test -- --run src/test/FocalEditor.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/components/FocalEditor.tsx web/src/test/FocalEditor.test.tsx
git commit -m "feat(web): add FocalEditor modal with drag/keyboard marker and crop previews"
```

---

## Task 11: Wire the editor into `AdminApp` + focal-aware thumbnails

**Files:**
- Modify: `web/src/AdminApp.tsx`
- Test: `web/src/test/AdminApp.test.tsx`

- [ ] **Step 1: Write the failing tests**

In `web/src/test/AdminApp.test.tsx`:

(a) Update the `photo()` helper to satisfy the new `AdminPhoto.focalSource` field:

```ts
const photo = (id: string, hidden = false): AdminPhoto => ({
  id, eventId: 'remembrance', source: 'seed', url: `/${id}.jpg`,
  url1024: `/${id}-1024.jpg`, url320: `/${id}-320.jpg`, credit: 'C', createdAt: 0, hidden,
  focalX: 0.5, focalY: 0.5, focalSource: 'unknown',
});
```

(b) Add a new `describe` block at the end of the file:

```tsx
describe('AdminApp focal editing', () => {
  beforeEach(() => {
    window.location.hash = '#t=admintok';
    vi.spyOn(adminApi, 'fetchAdminPhotos').mockResolvedValue([
      { ...photo('p1'), focalX: 0.25, focalY: 0.75, focalSource: 'detected' },
    ]);
    vi.spyOn(adminApi, 'fetchAdminMessages').mockResolvedValue([]);
  });

  it('thumbnails crop with focal-aware object-position', async () => {
    render(<AdminApp />);
    const img = await screen.findByRole('img');
    expect(img.style.objectPosition).toBe('25% 75%');
  });

  it('clicking a photo opens the focal editor modal', async () => {
    render(<AdminApp />);
    await screen.findByRole('img');
    fireEvent.click(screen.getByRole('button', { name: /edit focal point/i }));
    expect(await screen.findByRole('dialog', { name: /edit focal point/i })).toBeInTheDocument();
  });

  it('saving the editor calls updatePhotoFocal and updates the thumbnail crop', async () => {
    const spy = vi.spyOn(adminApi, 'updatePhotoFocal').mockResolvedValue();
    render(<AdminApp />);
    await screen.findByRole('img');
    fireEvent.click(screen.getByRole('button', { name: /edit focal point/i }));
    await screen.findByRole('dialog');
    fireEvent.pointerDown(screen.getByTestId('focal-image'), { clientX: 10, clientY: 90 });
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }));
    await waitFor(() => expect(spy).toHaveBeenCalledWith('remembrance', 'p1', 0.1, 0.9, 'admintok'));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.getByRole('img').style.objectPosition).toBe('10% 90%');
  });
});
```

> Note: the focal-editor tests rely on `getBoundingClientRect` returning a 100×100 box. Add the same `beforeEach` mock used in `FocalEditor.test.tsx` to this describe block:
>
> ```ts
>   vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
>     left: 0, top: 0, width: 100, height: 100, right: 100, bottom: 100, x: 0, y: 0, toJSON: () => ({}),
>   } as DOMRect);
> ```
>
> Place it as the first line of this block's `beforeEach`. The existing `afterEach` in the file already calls `vi.restoreAllMocks()`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm --prefix web run test -- --run src/test/AdminApp.test.tsx`
Expected: FAIL — no edit button / dialog; thumbnail has no `objectPosition`.

- [ ] **Step 3: Add imports, state, and handlers to `AdminApp`**

In `web/src/AdminApp.tsx`:

(a) Extend the adminApi import and add the helper + component imports:

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
} from './lib/adminApi';
import { objectPositionForPhoto } from './lib/focalPoint';
import { FocalEditor } from './components/FocalEditor';
```

(b) Add editor state next to the other `useState` hooks:

```ts
  const [editingId, setEditingId] = useState<string | null>(null);
```

(c) Add the focal handlers (place them after `onStyle`, before the `return`):

```ts
  const editing = photos.find((p) => p.id === editingId) ?? null;

  const onSaveFocal = async (focalX: number, focalY: number) => {
    if (!event || !editingId) return;
    await updatePhotoFocal(event.id, editingId, focalX, focalY, token);
    setPhotos((cur) =>
      cur.map((x) => (x.id === editingId ? { ...x, focalX, focalY, focalSource: 'manual' } : x)),
    );
  };

  const onRecalcFocal = async () => {
    if (!event || !editingId) return { focalX: 0.5, focalY: 0.5 };
    const r = await recalculatePhotoFocal(event.id, editingId, token);
    setPhotos((cur) =>
      cur.map((x) =>
        x.id === editingId ? { ...x, focalX: r.focalX, focalY: r.focalY, focalSource: r.focalSource } : x,
      ),
    );
    return { focalX: r.focalX, focalY: r.focalY };
  };
```

- [ ] **Step 4: Make the thumbnail a focal-aware open-editor button**

In `web/src/AdminApp.tsx`, replace the photo thumbnail container (the `<div className="relative aspect-square bg-neutral-900">...</div>` wrapping the `<img>` and badges) with a button:

```tsx
              <button
                type="button"
                onClick={() => setEditingId(p.id)}
                aria-label={`Edit focal point for ${p.id}`}
                className="relative block aspect-square w-full bg-neutral-900"
              >
                <img
                  src={p.url320}
                  alt={p.id}
                  className="w-full h-full object-cover"
                  style={{ objectPosition: objectPositionForPhoto(p) }}
                />
                <span className="absolute top-1 left-1 mono text-[0.55rem] uppercase tracking-wide px-1.5 py-0.5 rounded bg-black/60">
                  {p.source === 'seed' ? 'Seed' : 'Guest'}
                </span>
                {p.hidden && (
                  <span className="absolute bottom-1 left-1 mono text-[0.55rem] uppercase px-1.5 py-0.5 rounded bg-black/70">Hidden</span>
                )}
              </button>
```

- [ ] **Step 5: Render the modal**

In `web/src/AdminApp.tsx`, add the editor just before the final closing `</div>` of the root container (after the photos/messages conditional):

```tsx
      {editing && (
        <FocalEditor
          photo={editing}
          onSave={onSaveFocal}
          onRecalculate={onRecalcFocal}
          onClose={() => setEditingId(null)}
        />
      )}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npm --prefix web run test -- --run src/test/AdminApp.test.tsx`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add web/src/AdminApp.tsx web/src/test/AdminApp.test.tsx
git commit -m "feat(web): open FocalEditor from admin grid and crop thumbnails by focal point"
```

---

## Task 12: Full verification + roadmap/spec status

**Files:**
- Modify: `../mosaic-specs/v0.8.1-admin-focal-point-editor-spec.md` (status line)
- Modify: `../mosaic-specs/roadmap.md` (mark v0.8.1 shipped)

- [ ] **Step 1: Run the full test + typecheck matrix**

Run each and confirm all pass:

```bash
npm --prefix api run test -- --run
npm --prefix web run test -- --run
npm --prefix api run typecheck
npm --prefix web run typecheck
```

Expected: all green, no type errors. If any fail, fix before continuing — do not mark the spec done.

- [ ] **Step 2: Manual browser verification (focal editing is visual)**

Per `CLAUDE.md` §2, animation/visual surfaces are verified in the browser. Use the `run` skill (or `npm --prefix web run dev` + `npm --prefix api run dev`) and confirm, against a seeded event admin link:
- Clicking a photo opens the modal with the full image + 3 crop previews.
- Click and drag move the marker; previews update live.
- Arrow keys nudge the marker when it is focused; it never leaves the image.
- Save persists (reload shows the new crop in the grid thumbnail and slideshow).
- Cancel discards changes; Reset to center then Save stores center as `manual`.
- Recalculate reruns detection and moves the marker.

- [ ] **Step 3: Update the spec status and roadmap**

In `../mosaic-specs/v0.8.1-admin-focal-point-editor-spec.md`, change the status line:

```md
**Status:** Shipped — 2026-06-02
```

In `../mosaic-specs/roadmap.md`, move v0.8.1 to the shipped section (match the format used for prior shipped phases — read the file first and mirror it).

- [ ] **Step 4: Commit the docs**

```bash
git add ../mosaic-specs/v0.8.1-admin-focal-point-editor-spec.md ../mosaic-specs/roadmap.md
git commit -m "docs: mark v0.8.1 admin focal point editor shipped"
```

(Commit the spec repo from its own working tree if it is a separate git repo — `../mosaic-specs` is a sibling repo, so run these `git` commands inside `../mosaic-specs`.)

---

## Self-Review (completed during planning)

**Spec coverage:**
- Data model (`006_photo_focal_source.sql`, semantics) → Task 1. ✓
- API: admin responses include `focal_source` → Task 6 (admin list spreads `...p`; test added). ✓
- API: `PATCH .../focal` validate 0..1, set `manual`, 400/404, publish `photo_updated` → Task 6. ✓
- API: optional recalculate endpoint → Task 6 (user chose to ship). ✓
- API: public photo response keeps `focal_x`/`focal_y` and omits operational metadata → Task 7 (least-exposure hardening, added per security review). ✓
- Boot backfill skips `manual/detected/fallback`, processes only `unknown` → Task 4. ✓
- Upload + seed indexing set `detected`/`fallback` → Task 5. ✓
- Web: admin mapper maps `focal_source`→`focalSource`, default `unknown` → Task 9. ✓
- Web: marker render, click/drag updates marker + preview, Save normalized coords, Cancel restores, keyboard clamp → Tasks 10–11. ✓
- Web: three crop previews via `objectPosition` helper → Task 10. ✓
- Web: focal-aware admin thumbnails → Task 11 (user chose yes). ✓
- Tests sections (api + web) → covered across Tasks 1–11. ✓
- Verification commands → Task 12. ✓

**Type/name consistency:** `FocalSource` (api `types.ts` + web `types.ts`), `DetectedFocalPoint.source`, `updatePhotoFocalPoint(..., source)`, `updatePhotoFocal` / `recalculatePhotoFocal` (web), `clamp01` / `focalFromPoint` / `objectPositionForPhoto` (web), `FocalEditor` props `{ photo, onSave, onRecalculate, onClose }` — all used identically across tasks.

**Open questions resolved (via AskUserQuestion):** focused modal; ship recalculate endpoint; focal-aware thumbnails.

**Non-goals respected:** no new crop files, no aspect-specific crop boxes, no face-box visualization, no guest-facing or bulk editing, detector unchanged (only its return shape).
