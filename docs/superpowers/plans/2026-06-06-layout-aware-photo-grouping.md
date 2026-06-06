# Layout-Aware Photo Grouping Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Auto-classify each photo as `group` (safe to crop into a slideshow column) or `solo` (shown full-screen only), from orientation + detected face count, with an admin override — so landscape group shots never get cropped in duo/triptych/polaroid slides.

**Architecture:** Persist raw signals (`width`, `height`, `face_count`) plus a nullable `layout_override` on `photos`. A single pure function `resolveLayout()` (API side) turns those into `group`/`solo`; the API hands the wall a ready-resolved `layout`. `buildSequence` keeps `solo` photos out of grouping slides. Admin overrides live in the existing per-photo focal editor. Existing photos are classified by a boot backfill, exactly like focal points.

**Tech Stack:** TypeScript, Fastify, better-sqlite3, sharp, face-api.js (API); React, Vite, Vitest, Testing Library (web).

**Spec:** `../mosaic-specs/v0.11-layout-aware-photo-grouping-spec.md`

---

## File Structure

**API (`api/`):**
- Create `migrations/007_photo_layout.sql` — adds `width`, `height`, `face_count`, `layout_override`.
- Create `src/lib/layout.ts` — `Layout` re-export + `resolveLayout()` pure function.
- Modify `src/types.ts` — `Layout` type; `PhotoRow` gains the four columns.
- Modify `src/lib/focalPoint.ts` — `detectFocalPoint` also returns `width`/`height`/`face_count`.
- Modify `src/db/queries.ts` — `insertPhoto` persists signals; add `updatePhotoLayoutOverride`, `updatePhotoLayoutSignals`.
- Modify `src/routes/photos.ts` — upload persists signals.
- Modify `src/routes/events.ts` — public photo gains resolved `layout`.
- Modify `src/routes/admin.ts` — admin photo gains resolved `layout`; new `PATCH …/layout`.
- Create `src/lib/backfillPhotoLayout.ts`; wire into `src/server.ts`.

**Web (`web/`):**
- Modify `src/types.ts` — `Layout`; `Photo.layout`; `AdminPhoto` raw fields + override.
- Modify `src/lib/api.ts` — `toPhoto` maps `layout`.
- Modify `src/lib/adminApi.ts` — `toAdminPhoto` maps new fields; add `setPhotoLayout`.
- Modify `src/lib/buildSequence.ts` — split `plain` into `plainGroup` / `plainSolo`.
- Modify `src/components/FocalEditor.tsx` — Auto/Group/Solo control.
- Modify `src/AdminApp.tsx` — grid badge + `onSetLayout` handler.

**Conventions:** Conventional Commits. End every commit message body with:
```
Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
```
Run tests from the repo root with the `--prefix` form shown in each step.

---

## Task 1: Migration — add layout columns

**Files:**
- Create: `api/migrations/007_photo_layout.sql`
- Test: `api/test/migrate.test.ts` (modify)

- [ ] **Step 1: Write the failing test**

Add these two tests inside the `describe('migrate', …)` block in `api/test/migrate.test.ts` (after the existing `006` tests):

```ts
  it('adds photos layout columns with the right defaults', () => {
    const db = openDatabase(':memory:');
    migrate(db);
    const cols = db.prepare('PRAGMA table_info(photos)').all() as {
      name: string;
      dflt_value: string | null;
    }[];
    expect(cols.find((c) => c.name === 'width')?.dflt_value).toBe('0');
    expect(cols.find((c) => c.name === 'height')?.dflt_value).toBe('0');
    expect(cols.find((c) => c.name === 'face_count')?.dflt_value).toBe('0');
    const override = cols.find((c) => c.name === 'layout_override');
    expect(override).toBeDefined();
    expect(override?.dflt_value).toBeNull();
    db.close();
  });

  it('records 007_photo_layout.sql exactly once', () => {
    const db = openDatabase(':memory:');
    migrate(db);
    migrate(db);
    const n = (
      db
        .prepare("SELECT count(*) AS n FROM schema_migrations WHERE filename = '007_photo_layout.sql'")
        .get() as { n: number }
    ).n;
    expect(n).toBe(1);
    db.close();
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm --prefix api run test -- --run migrate`
Expected: FAIL — `width` column not found (`dflt_value` is `undefined`, not `'0'`).

- [ ] **Step 3: Create the migration**

Create `api/migrations/007_photo_layout.sql`:

```sql
ALTER TABLE photos ADD COLUMN width INTEGER NOT NULL DEFAULT 0;
ALTER TABLE photos ADD COLUMN height INTEGER NOT NULL DEFAULT 0;
ALTER TABLE photos ADD COLUMN face_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE photos ADD COLUMN layout_override TEXT
  CHECK (layout_override IN ('group', 'solo'));
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm --prefix api run test -- --run migrate`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add api/migrations/007_photo_layout.sql api/test/migrate.test.ts
git commit -m "$(printf 'feat(api): add photos layout columns (007 migration)\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

## Task 2: `resolveLayout` pure function + `Layout` type

**Files:**
- Modify: `api/src/types.ts` (add `Layout`)
- Create: `api/src/lib/layout.ts`
- Test: `api/test/layout.test.ts`

- [ ] **Step 1: Add the `Layout` type**

In `api/src/types.ts`, add next to the other type aliases at the top (near `FocalSource`):

```ts
export type Layout = 'group' | 'solo';
```

- [ ] **Step 2: Write the failing test**

Create `api/test/layout.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { resolveLayout } from '../src/lib/layout.js';

describe('resolveLayout', () => {
  it('treats portrait as group regardless of face count', () => {
    expect(resolveLayout({ width: 600, height: 900, faceCount: 5, override: null })).toBe('group');
  });

  it('treats a landscape with 0 or 1 face as group', () => {
    expect(resolveLayout({ width: 900, height: 600, faceCount: 0, override: null })).toBe('group');
    expect(resolveLayout({ width: 900, height: 600, faceCount: 1, override: null })).toBe('group');
  });

  it('treats a landscape with 2+ faces as solo', () => {
    expect(resolveLayout({ width: 900, height: 600, faceCount: 2, override: null })).toBe('solo');
    expect(resolveLayout({ width: 900, height: 600, faceCount: 9, override: null })).toBe('solo');
  });

  it('treats square as group unless 2+ faces', () => {
    expect(resolveLayout({ width: 500, height: 500, faceCount: 1, override: null })).toBe('group');
    expect(resolveLayout({ width: 500, height: 500, faceCount: 2, override: null })).toBe('solo');
  });

  it('lets an override win over the auto rule', () => {
    expect(resolveLayout({ width: 600, height: 900, faceCount: 0, override: 'solo' })).toBe('solo');
    expect(resolveLayout({ width: 900, height: 600, faceCount: 5, override: 'group' })).toBe('group');
  });

  it('treats unanalyzed (zero) dimensions as group', () => {
    expect(resolveLayout({ width: 0, height: 0, faceCount: 0, override: null })).toBe('group');
    expect(resolveLayout({ width: 0, height: 900, faceCount: 5, override: null })).toBe('group');
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm --prefix api run test -- --run layout`
Expected: FAIL — cannot find module `../src/lib/layout.js`.

- [ ] **Step 4: Create the implementation**

Create `api/src/lib/layout.ts`:

```ts
import type { Layout } from '../types.js';

export type { Layout };

/**
 * Decide whether a photo may be cropped into a slideshow column (`group`) or
 * must be shown full-screen on its own (`solo`). An admin override always wins;
 * otherwise the rule is: portrait fits a column; a landscape/square is solo
 * only when 2+ faces would be cut off by the crop. Unanalyzed (zero-dimension)
 * photos default to `group` so nothing regresses before backfill.
 */
export function resolveLayout(input: {
  width: number;
  height: number;
  faceCount: number;
  override: Layout | null;
}): Layout {
  if (input.override) return input.override;
  if (input.width <= 0 || input.height <= 0) return 'group';
  if (input.height > input.width) return 'group';
  return input.faceCount >= 2 ? 'solo' : 'group';
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm --prefix api run test -- --run layout`
Expected: PASS.

- [ ] **Step 6: Typecheck and commit**

Run: `npm --prefix api run typecheck`
Expected: no errors.

```bash
git add api/src/types.ts api/src/lib/layout.ts api/test/layout.test.ts
git commit -m "$(printf 'feat(api): add resolveLayout(group/solo) classifier\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

## Task 3: Detection returns width/height/face_count

**Files:**
- Modify: `api/src/lib/focalPoint.ts:9-16` (interface), `api/src/lib/focalPoint.ts:140-156` (`detectFocalPoint`)
- Test: `api/test/focalPoint.test.ts` (modify)

- [ ] **Step 1: Update the existing tests to expect the new fields (failing)**

In `api/test/focalPoint.test.ts`, replace the two `detectFocalPoint` assertions so they expect dimensions and a face count. The `testImage()` helper produces a 100×100 JPEG.

Replace the body of the `'reports fallback + center …'` test:

```ts
  it('reports fallback + center when the detector returns no usable faces', async () => {
    __setFocalPointDetectorForTest(async () => []);
    await expect(detectFocalPoint(await testImage())).resolves.toEqual({
      focal_x: 0.5,
      focal_y: 0.5,
      source: 'fallback',
      width: 100,
      height: 100,
      face_count: 0,
    });
  });
```

Replace the body of the `'reports detected …'` test:

```ts
  it('reports detected when the detector returns a face', async () => {
    __setFocalPointDetectorForTest(async () => [{ x: 10, y: 20, width: 30, height: 40 }]);
    await expect(detectFocalPoint(await testImage())).resolves.toEqual({
      focal_x: 0.25,
      focal_y: 0.4,
      source: 'detected',
      width: 100,
      height: 100,
      face_count: 1,
    });
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm --prefix api run test -- --run focalPoint`
Expected: FAIL — received object is missing `width`/`height`/`face_count`.

- [ ] **Step 3: Extend the interface**

In `api/src/lib/focalPoint.ts`, replace the `DetectedFocalPoint` interface (around line 14):

```ts
export interface DetectedFocalPoint extends FocalPoint {
  source: 'detected' | 'fallback';
  width: number;
  height: number;
  face_count: number;
}
```

- [ ] **Step 4: Extend `detectFocalPoint`**

Replace the whole `detectFocalPoint` function body (around lines 140-156) with:

```ts
export async function detectFocalPoint(buf: Buffer): Promise<DetectedFocalPoint> {
  return enqueue(async () => {
    let width = 0;
    let height = 0;
    try {
      const meta = await sharp(buf).metadata();
      width = meta.width ?? 0;
      height = meta.height ?? 0;
      if (!width || !height) {
        return { ...CENTER_FOCAL_POINT, source: 'fallback', width, height, face_count: 0 };
      }
      const prepared = await prepareDetectionBuffer(buf);
      if (!prepared.width || !prepared.height) {
        return { ...CENTER_FOCAL_POINT, source: 'fallback', width, height, face_count: 0 };
      }
      const faces = await detector(prepared.buf);
      if (faces.length === 0) {
        return { ...CENTER_FOCAL_POINT, source: 'fallback', width, height, face_count: 0 };
      }
      return {
        ...focalPointFromFaces(prepared.width, prepared.height, faces),
        source: 'detected',
        width,
        height,
        face_count: faces.length,
      };
    } catch (err) {
      console.warn(`[focal] falling back to center: ${err instanceof Error ? err.message : String(err)}`);
      return { ...CENTER_FOCAL_POINT, source: 'fallback', width, height, face_count: 0 };
    }
  });
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm --prefix api run test -- --run focalPoint`
Expected: PASS.

- [ ] **Step 6: Typecheck and commit**

Run: `npm --prefix api run typecheck`
Expected: no errors.

```bash
git add api/src/lib/focalPoint.ts api/test/focalPoint.test.ts
git commit -m "$(printf 'feat(api): surface width/height/face_count from detectFocalPoint\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

## Task 4: Persist signals + layout queries

**Files:**
- Modify: `api/src/types.ts` (`PhotoRow`)
- Modify: `api/src/db/queries.ts` (`InsertPhotoInput`, `insertPhoto`, two new functions)
- Modify: `api/src/routes/photos.ts:86-97` (pass signals to `insertPhoto`)
- Test: `api/test/queries.test.ts` (modify)

- [ ] **Step 1: Extend `PhotoRow`**

In `api/src/types.ts`, add the four fields to `PhotoRow` (after `focal_source`):

```ts
  focal_source: FocalSource;
  width: number;
  height: number;
  face_count: number;
  layout_override: Layout | null;
```

- [ ] **Step 2: Write the failing tests**

In `api/test/queries.test.ts`, add a new `describe` block (place it near the other photo query tests; it uses the same `db` setup pattern already in the file — follow the existing `beforeEach`/`openDatabase(':memory:')` + `applySchemaFromString` harness used there):

```ts
describe('photo layout signals', () => {
  it('insertPhoto defaults signals to 0 and override to null', () => {
    insertPhoto(db, {
      id: 'lp1', event_id: 'remembrance', source: 'upload',
      filename: 'lp1.jpg', credit: 'C', created_at: 1,
    });
    const row = listAllPhotos(db, 'remembrance').find((r) => r.id === 'lp1')!;
    expect(row).toMatchObject({ width: 0, height: 0, face_count: 0, layout_override: null });
  });

  it('insertPhoto persists provided signals', () => {
    insertPhoto(db, {
      id: 'lp2', event_id: 'remembrance', source: 'upload',
      filename: 'lp2.jpg', credit: 'C', created_at: 2,
      width: 900, height: 600, face_count: 3,
    });
    const row = listAllPhotos(db, 'remembrance').find((r) => r.id === 'lp2')!;
    expect(row).toMatchObject({ width: 900, height: 600, face_count: 3 });
  });

  it('updatePhotoLayoutOverride sets and clears the override', () => {
    insertPhoto(db, {
      id: 'lp3', event_id: 'remembrance', source: 'upload',
      filename: 'lp3.jpg', credit: 'C', created_at: 3,
    });
    expect(updatePhotoLayoutOverride(db, 'remembrance', 'lp3', 'solo')).toBe(true);
    expect(listAllPhotos(db, 'remembrance').find((r) => r.id === 'lp3')!.layout_override).toBe('solo');
    expect(updatePhotoLayoutOverride(db, 'remembrance', 'lp3', null)).toBe(true);
    expect(listAllPhotos(db, 'remembrance').find((r) => r.id === 'lp3')!.layout_override).toBeNull();
    expect(updatePhotoLayoutOverride(db, 'remembrance', 'missing', 'solo')).toBe(false);
  });

  it('updatePhotoLayoutSignals writes dimensions and face count', () => {
    insertPhoto(db, {
      id: 'lp4', event_id: 'remembrance', source: 'upload',
      filename: 'lp4.jpg', credit: 'C', created_at: 4,
    });
    expect(updatePhotoLayoutSignals(db, 'remembrance', 'lp4', 800, 1200, 1)).toBe(true);
    expect(listAllPhotos(db, 'remembrance').find((r) => r.id === 'lp4')!)
      .toMatchObject({ width: 800, height: 1200, face_count: 1 });
  });
});
```

Add `updatePhotoLayoutOverride` and `updatePhotoLayoutSignals` to the existing import from `'../src/db/queries.js'` at the top of `queries.test.ts`. Ensure the test file's setup inserts/owns the `remembrance` event (it already does for other photo tests — reuse that setup; if a fresh block, mirror the existing `upsertEvent` call used elsewhere in the file).

- [ ] **Step 3: Run test to verify it fails**

Run: `npm --prefix api run test -- --run queries`
Expected: FAIL — `updatePhotoLayoutOverride` is not exported / not a function.

- [ ] **Step 4: Implement the query changes**

In `api/src/db/queries.ts`:

(a) Extend `InsertPhotoInput` (add after `focal_source?`):

```ts
  focal_source?: FocalSource;
  width?: number;
  height?: number;
  face_count?: number;
```

(b) Replace `insertPhoto`:

```ts
export function insertPhoto(db: DB, p: InsertPhotoInput): PhotoRow {
  const row = {
    ...p,
    focal_x: p.focal_x ?? 0.5,
    focal_y: p.focal_y ?? 0.5,
    focal_source: p.focal_source ?? 'unknown',
    width: p.width ?? 0,
    height: p.height ?? 0,
    face_count: p.face_count ?? 0,
  };
  db.prepare(
    `INSERT INTO photos (id, event_id, source, filename, credit, created_at, focal_x, focal_y, focal_source, width, height, face_count)
     VALUES (@id, @event_id, @source, @filename, @credit, @created_at, @focal_x, @focal_y, @focal_source, @width, @height, @face_count)`,
  ).run(row);
  return { ...row, hidden: 0, layout_override: null } as PhotoRow;
}
```

(c) Add two functions at the end of the file (after `updatePhotoFocalPoint`). Import `Layout` in the type import at the top: change the existing `import type { … FocalSource } from '../types.js';` to also include `Layout`.

```ts
export function updatePhotoLayoutOverride(
  db: DB,
  eventId: string,
  photoId: string,
  layout: Layout | null,
): boolean {
  const info = db
    .prepare('UPDATE photos SET layout_override = ? WHERE id = ? AND event_id = ?')
    .run(layout, photoId, eventId);
  return info.changes > 0;
}

export function updatePhotoLayoutSignals(
  db: DB,
  eventId: string,
  photoId: string,
  width: number,
  height: number,
  faceCount: number,
): boolean {
  const info = db
    .prepare('UPDATE photos SET width = ?, height = ?, face_count = ? WHERE id = ? AND event_id = ?')
    .run(width, height, faceCount, photoId, eventId);
  return info.changes > 0;
}
```

- [ ] **Step 5: Persist signals on upload**

In `api/src/routes/photos.ts`, extend the `insertPhoto` call (the `focal` result already exists at line 83) to pass the new signals:

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
          width: focal.width,
          height: focal.height,
          face_count: focal.face_count,
        });
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npm --prefix api run test -- --run queries`
Expected: PASS.

- [ ] **Step 7: Typecheck and commit**

Run: `npm --prefix api run typecheck`
Expected: no errors.

```bash
git add api/src/types.ts api/src/db/queries.ts api/src/routes/photos.ts api/test/queries.test.ts
git commit -m "$(printf 'feat(api): persist layout signals and add layout queries\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

## Task 5: API surface — public `layout`, admin fields, PATCH endpoint

**Files:**
- Modify: `api/src/routes/events.ts:7-20` (`toPublicPhoto`)
- Modify: `api/src/routes/admin.ts` (GET map + new PATCH route + imports)
- Test: `api/test/routes.test.ts` (modify)

- [ ] **Step 1: Write the failing tests**

In `api/test/routes.test.ts`, add these tests. Place the public test inside the `describe('GET /api/events/:id/photos', …)` block, and the admin tests near the existing `'PATCH admin/photos/:id/focal …'` test. They follow the file's existing harness (`app.inject`, `adminAuth()`, `insertPhoto`, `__setFocalPointDetectorForTest`).

Public payload exposes resolved `layout` (a seed photo has `width=0` ⇒ `group`):

```ts
  it('exposes a resolved layout on public photos', async () => {
    const dir = path.join(paths.seedsDir, 'remembrance');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'one.jpg'), jpegWithExif);
    await indexSeedsForEvent(db, paths, 'remembrance');
    const res = await app.inject({ method: 'GET', url: '/api/events/remembrance/photos' });
    const body = res.json() as Array<{ layout: string }>;
    expect(body[0]?.layout).toBe('group');
  });
```

Admin payload exposes raw signals + override + resolved layout; PATCH sets/validates/clears:

```ts
  it('GET admin/photos includes layout signals and resolved layout', async () => {
    insertPhoto(db, {
      id: 'lay1', event_id: 'remembrance', source: 'upload', filename: 'lay1.jpg',
      credit: 'C', created_at: 1, width: 900, height: 600, face_count: 3,
    });
    const res = await app.inject({ method: 'GET', url: '/api/events/remembrance/admin/photos', headers: { authorization: adminAuth() } });
    const body = res.json() as Array<{ id: string; width: number; height: number; face_count: number; layout_override: string | null; layout: string }>;
    expect(body.find((p) => p.id === 'lay1')).toMatchObject({
      width: 900, height: 600, face_count: 3, layout_override: null, layout: 'solo',
    });
  });

  it('PATCH admin/photos/:id/layout sets, resolves, validates, and 404s', async () => {
    insertPhoto(db, {
      id: 'lay2', event_id: 'remembrance', source: 'upload', filename: 'lay2.jpg',
      credit: 'C', created_at: 1, width: 900, height: 600, face_count: 0, // auto => group
    });

    const set = await app.inject({
      method: 'PATCH', url: '/api/events/remembrance/admin/photos/lay2/layout',
      payload: { layout: 'solo' }, headers: { authorization: adminAuth() },
    });
    expect(set.statusCode).toBe(200);
    expect(set.json()).toMatchObject({ ok: true, layout: 'solo' });

    const reset = await app.inject({
      method: 'PATCH', url: '/api/events/remembrance/admin/photos/lay2/layout',
      payload: { layout: null }, headers: { authorization: adminAuth() },
    });
    expect(reset.json()).toMatchObject({ ok: true, layout: 'group' });

    const bad = await app.inject({
      method: 'PATCH', url: '/api/events/remembrance/admin/photos/lay2/layout',
      payload: { layout: 'sideways' }, headers: { authorization: adminAuth() },
    });
    expect(bad.statusCode).toBe(400);

    const missing = await app.inject({
      method: 'PATCH', url: '/api/events/remembrance/admin/photos/nope/layout',
      payload: { layout: 'solo' }, headers: { authorization: adminAuth() },
    });
    expect(missing.statusCode).toBe(404);
  });

  it('PATCH admin/photos/:id/layout requires admin (401 for guest)', async () => {
    const res = await app.inject({
      method: 'PATCH', url: '/api/events/remembrance/admin/photos/lay2/layout',
      payload: { layout: 'solo' }, headers: { authorization: validAuth() },
    });
    expect(res.statusCode).toBe(401);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm --prefix api run test -- --run routes`
Expected: FAIL — public photo has no `layout`; PATCH route 404s on every path (not registered).

- [ ] **Step 3: Add resolved `layout` to public photos**

In `api/src/routes/events.ts`, add the import and the field. At the top:

```ts
import { resolveLayout } from '../lib/layout.js';
```

In `toPublicPhoto`, add `layout` to the returned object (after `focal_y`):

```ts
    focal_x: p.focal_x,
    focal_y: p.focal_y,
    layout: resolveLayout({ width: p.width, height: p.height, faceCount: p.face_count, override: p.layout_override }),
```

- [ ] **Step 4: Add resolved `layout` to admin photos + the PATCH route**

In `api/src/routes/admin.ts`:

(a) Add imports — `resolveLayout` and `updatePhotoLayoutOverride`:

```ts
import { resolveLayout } from '../lib/layout.js';
```
and add `updatePhotoLayoutOverride` to the existing `'../db/queries.js'` import list.

(b) In the `GET /admin/photos` handler, add `layout` to the mapped object (the spread `...p` already carries `width`/`height`/`face_count`/`layout_override`):

```ts
      return listAdminPhotos(db, req.params.id).map((p) => ({
        ...p,
        layout: resolveLayout({ width: p.width, height: p.height, faceCount: p.face_count, override: p.layout_override }),
        url: publicUrlForPhoto(p.source, p.event_id, p.filename),
        url_1024: publicUrlForVariant(p.event_id, p.filename, 1024),
        url_320: publicUrlForVariant(p.event_id, p.filename, 320),
      }));
```

(c) Add a validator helper near the top of the file (after `isUnitNumber`):

```ts
function isLayoutOverride(v: unknown): v is 'group' | 'solo' | null {
  return v === null || v === 'group' || v === 'solo';
}
```

(d) Add the PATCH route (place it right after the existing `…/focal/recalculate` route):

```ts
  app.patch<{ Params: { id: string; photoId: string }; Body: { layout?: unknown } }>(
    '/api/events/:id/admin/photos/:photoId/layout',
    { preHandler: requireAdmin },
    async (req, reply) => {
      const layout = req.body?.layout ?? null;
      if (!isLayoutOverride(layout)) {
        return reply.code(400).send({ error: "layout must be 'group', 'solo', or null" });
      }
      const updated = updatePhotoLayoutOverride(db, req.params.id, req.params.photoId, layout);
      if (!updated) return reply.code(404).send({ error: 'photo not found' });
      const row = getPhotoForEvent(db, req.params.id, req.params.photoId)!;
      const resolved = resolveLayout({
        width: row.width,
        height: row.height,
        faceCount: row.face_count,
        override: row.layout_override,
      });
      liveUpdates?.publish({ type: 'photo_updated', eventId: req.params.id, createdAt: Date.now() });
      return { ok: true, layout: resolved };
    },
  );
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm --prefix api run test -- --run routes`
Expected: PASS.

- [ ] **Step 6: Typecheck and commit**

Run: `npm --prefix api run typecheck`
Expected: no errors.

```bash
git add api/src/routes/events.ts api/src/routes/admin.ts api/test/routes.test.ts
git commit -m "$(printf 'feat(api): expose resolved layout and add layout override endpoint\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

## Task 6: Backfill layout signals on boot

**Files:**
- Create: `api/src/lib/backfillPhotoLayout.ts`
- Modify: `api/src/server.ts:13-61` (import + call)
- Test: `api/test/backfillPhotoLayout.test.ts`

- [ ] **Step 1: Write the failing test**

Create `api/test/backfillPhotoLayout.test.ts` (modeled on `backfillFocalPoints.test.ts`):

```ts
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { openDatabase, type DB } from '../src/db/index.js';
import { applySchemaFromString } from '../src/db/migrate.js';
import { insertPhoto, listAllPhotos, upsertEvent } from '../src/db/queries.js';
import { backfillPhotoLayout } from '../src/lib/backfillPhotoLayout.js';
import { makeStoragePaths, seedsDirFor, type StoragePaths } from '../src/lib/storage.js';
import {
  __resetFocalPointForTest,
  __setFocalPointDetectorForTest,
} from '../src/lib/focalPoint.js';

const migrationsDir = path.resolve(__dirname, '..', 'migrations');
const SCHEMA = fs
  .readdirSync(migrationsDir)
  .filter((f) => f.endsWith('.sql'))
  .sort()
  .map((f) => fs.readFileSync(path.join(migrationsDir, f), 'utf8'))
  .join('\n');

const eventId = 'remembrance';
let tmpDir: string;
let db: DB;
let paths: StoragePaths;

async function makeJpeg(width: number, height: number): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 3 as const, background: 'white' } }).jpeg().toBuffer();
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mosaic-layout-backfill-'));
  paths = makeStoragePaths(tmpDir);
  fs.mkdirSync(paths.seedsDir, { recursive: true });
  db = openDatabase(':memory:');
  applySchemaFromString(db, SCHEMA);
  upsertEvent(db, {
    id: eventId, mode: 'remembrance', eyebrow: 'In memory', title: 'X', dateline: 'date',
    place: 'place', invitation: 'invite', brand_sub: 'sub', short_code: 'X1', transition_style: 'default',
  });
  __setFocalPointDetectorForTest(async () => [
    { x: 10, y: 10, width: 20, height: 20 },
    { x: 60, y: 10, width: 20, height: 20 },
  ]);
});

afterEach(() => {
  __resetFocalPointForTest();
  db.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('backfillPhotoLayout', () => {
  it('fills width/height/face_count for unanalyzed rows', async () => {
    const seedDir = seedsDirFor(paths, eventId);
    fs.mkdirSync(seedDir, { recursive: true });
    fs.writeFileSync(path.join(seedDir, 'wide.jpg'), await makeJpeg(200, 100));
    insertPhoto(db, { id: 'w1', event_id: eventId, source: 'seed', filename: 'wide.jpg', credit: 'Host', created_at: 1 });

    await expect(backfillPhotoLayout(db, paths, eventId)).resolves.toEqual({ updated: 1, skipped: 0 });

    expect(listAllPhotos(db, eventId)[0]).toMatchObject({ width: 200, height: 100, face_count: 2 });
  });

  it('skips already-analyzed rows and missing originals', async () => {
    insertPhoto(db, { id: 'done', event_id: eventId, source: 'seed', filename: 'a.jpg', credit: 'Host', created_at: 1, width: 640, height: 480, face_count: 0 });
    insertPhoto(db, { id: 'missing', event_id: eventId, source: 'seed', filename: 'missing.jpg', credit: 'Host', created_at: 2 });

    await expect(backfillPhotoLayout(db, paths, eventId)).resolves.toEqual({ updated: 0, skipped: 2 });
    expect(listAllPhotos(db, eventId).find((r) => r.id === 'done')).toMatchObject({ width: 640, height: 480 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm --prefix api run test -- --run backfillPhotoLayout`
Expected: FAIL — cannot find module `../src/lib/backfillPhotoLayout.js`.

- [ ] **Step 3: Create the backfill**

Create `api/src/lib/backfillPhotoLayout.ts`:

```ts
import fs from 'node:fs';
import path from 'node:path';
import type { DB } from '../db/index.js';
import { listAllPhotos, updatePhotoLayoutSignals } from '../db/queries.js';
import { seedsDirFor, uploadsDirFor, type StoragePaths } from './storage.js';
import { detectFocalPoint } from './focalPoint.js';

export interface BackfillPhotoLayoutResult {
  updated: number;
  skipped: number;
}

export async function backfillPhotoLayout(
  db: DB,
  paths: StoragePaths,
  eventId: string,
): Promise<BackfillPhotoLayoutResult> {
  let updated = 0;
  let skipped = 0;

  for (const row of listAllPhotos(db, eventId)) {
    if (row.width > 0 && row.height > 0) {
      skipped += 1;
      continue;
    }

    const sourceDir = row.source === 'seed' ? seedsDirFor(paths, eventId) : uploadsDirFor(paths, eventId);
    const originalPath = path.join(sourceDir, row.filename);
    if (!fs.existsSync(originalPath)) {
      skipped += 1;
      continue;
    }

    const detected = await detectFocalPoint(fs.readFileSync(originalPath));
    if (updatePhotoLayoutSignals(db, eventId, row.id, detected.width, detected.height, detected.face_count)) {
      updated += 1;
    }
  }

  return { updated, skipped };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm --prefix api run test -- --run backfillPhotoLayout`
Expected: PASS.

- [ ] **Step 5: Wire into server boot**

In `api/src/server.ts`, add the import next to the other backfill imports:

```ts
import { backfillPhotoLayout } from './lib/backfillPhotoLayout.js';
```

And after the focal backfill block (lines 58-61), add:

```ts
  const layoutResult = await backfillPhotoLayout(db, paths, event.id);
  if (layoutResult.updated > 0) {
    console.warn(`[layout] backfilled ${layoutResult.updated} photo layout signals for ${event.id}`);
  }
```

- [ ] **Step 6: Typecheck and commit**

Run: `npm --prefix api run typecheck`
Expected: no errors.

```bash
git add api/src/lib/backfillPhotoLayout.ts api/src/server.ts api/test/backfillPhotoLayout.test.ts
git commit -m "$(printf 'feat(api): backfill photo layout signals on boot\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

## Task 7: Web types + mappers + `setPhotoLayout`

**Files:**
- Modify: `web/src/types.ts`
- Modify: `web/src/lib/api.ts:16-27` (`ApiPhoto`), `:51-62` (`toPhoto`)
- Modify: `web/src/lib/adminApi.ts:3-31` (`ApiAdminPhoto` + `toAdminPhoto`), add `setPhotoLayout`
- Test: `web/src/test/api.test.ts`, `web/src/test/adminApi.test.ts`

- [ ] **Step 1: Write the failing tests**

In `web/src/test/api.test.ts`, add inside a `describe('fetchPhotos', …)` block (create it if absent), or alongside the existing photo tests:

```ts
describe('fetchPhotos layout', () => {
  it('maps layout and defaults a missing value to group', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => [
        { ...okPhoto, layout: 'solo' },
        { ...okPhoto, id: 'p2' }, // no layout field
      ],
    });
    vi.stubGlobal('fetch', fetchMock);
    const photos = await fetchPhotos('remembrance');
    expect(photos[0]!.layout).toBe('solo');
    expect(photos[1]!.layout).toBe('group');
  });
});
```

In `web/src/test/adminApi.test.ts`, add `setPhotoLayout` to the imports from `'../lib/adminApi'`, then add:

```ts
  it('maps layout signals and defaults missing values', async () => {
    mockFetch(() => ({
      ok: true,
      json: async () => [{ id: 'p1', event_id: 'e1', source: 'seed', url: '/u', url_1024: '/a', url_320: '/b', credit: 'C', created_at: 1, hidden: 0, focal_x: 0.5, focal_y: 0.5, width: 900, height: 600, face_count: 3, layout_override: 'solo', layout: 'solo' }],
    }));
    const photos = await fetchAdminPhotos('e1', 'tok');
    expect(photos[0]).toMatchObject({ width: 900, height: 600, faceCount: 3, layoutOverride: 'solo', layout: 'solo' });
  });

  it('defaults missing layout fields', async () => {
    mockFetch(() => ({
      ok: true,
      json: async () => [{ id: 'p1', event_id: 'e1', source: 'seed', url: '/u', url_1024: '/a', url_320: '/b', credit: 'C', created_at: 1, hidden: 0, focal_x: 0.5, focal_y: 0.5 }],
    }));
    const photos = await fetchAdminPhotos('e1', 'tok');
    expect(photos[0]).toMatchObject({ width: 0, height: 0, faceCount: 0, layoutOverride: null, layout: 'group' });
  });

  it('setPhotoLayout PATCHes the chosen value and returns resolved layout', async () => {
    const fn = mockFetch(() => ({ ok: true, json: async () => ({ ok: true, layout: 'solo' }) }));
    const resolved = await setPhotoLayout('e1', 'p1', 'solo', 'tok');
    expect(fn).toHaveBeenCalledWith('/api/events/e1/admin/photos/p1/layout', expect.objectContaining({
      method: 'PATCH',
      body: JSON.stringify({ layout: 'solo' }),
    }));
    expect(resolved).toBe('solo');
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm --prefix web run test -- --run api.test adminApi`
Expected: FAIL — `layout` undefined / `setPhotoLayout` is not exported.

- [ ] **Step 3: Extend web types**

In `web/src/types.ts`, add the `Layout` alias near `FocalSource`:

```ts
export type Layout = 'group' | 'solo';
```

Add `layout` to `Photo` (after `focalY`):

```ts
  focalY: number;
  layout: Layout;
```

Extend `AdminPhoto`:

```ts
export interface AdminPhoto extends Photo {
  hidden: boolean;
  focalSource: FocalSource;
  width: number;
  height: number;
  faceCount: number;
  layoutOverride: Layout | null;
}
```

- [ ] **Step 4: Map `layout` in `toPhoto`**

In `web/src/lib/api.ts`, add `layout?` to the `ApiPhoto` interface:

```ts
  focal_x?: number;
  focal_y?: number;
  layout?: 'group' | 'solo';
```

And in `toPhoto`, add (after `focalY`):

```ts
  focalY: p.focal_y ?? 0.5,
  layout: p.layout ?? 'group',
```

- [ ] **Step 5: Map admin fields + add `setPhotoLayout`**

In `web/src/lib/adminApi.ts`:

(a) Import `Layout`:

```ts
import type { AdminMessage, AdminPhoto, FocalSource, Layout, TransitionStyle } from '../types';
```

(b) Extend `ApiAdminPhoto`:

```ts
  focal_x?: number;
  focal_y?: number;
  focal_source?: FocalSource;
  width?: number;
  height?: number;
  face_count?: number;
  layout_override?: Layout | null;
  layout?: Layout;
```

(c) Extend `toAdminPhoto` (add after `focalSource`):

```ts
  focalSource: p.focal_source ?? 'unknown',
  width: p.width ?? 0,
  height: p.height ?? 0,
  faceCount: p.face_count ?? 0,
  layoutOverride: p.layout_override ?? null,
  layout: p.layout ?? 'group',
```

(d) Add the API call (after `recalculatePhotoFocal`):

```ts
export async function setPhotoLayout(
  eventId: string,
  photoId: string,
  layout: Layout | null,
  token: string,
): Promise<Layout> {
  const url = `/api/events/${eventId}/admin/photos/${photoId}/layout`;
  const res = await ensureOk(await fetch(url, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json', ...authHeaders(token) },
    body: JSON.stringify({ layout }),
  }), url);
  const data = (await res.json()) as { layout: Layout };
  return data.layout;
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npm --prefix web run test -- --run api.test adminApi`
Expected: PASS.

- [ ] **Step 7: Typecheck and commit**

Run: `npm --prefix web run typecheck`
Expected: no errors. (If it flags a `Photo` literal built outside the mappers, add `layout: 'group'` there — the mappers in `api.ts`/`adminApi.ts` are the only constructors, so none is expected.)

```bash
git add web/src/types.ts web/src/lib/api.ts web/src/lib/adminApi.ts web/src/test/api.test.ts web/src/test/adminApi.test.ts
git commit -m "$(printf 'feat(web): map photo layout and add setPhotoLayout\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

## Task 8: Sequence builder keeps `solo` photos out of grouping slides

**Files:**
- Modify: `web/src/lib/buildSequence.ts`
- Test: `web/src/test/buildSequence.test.ts`

- [ ] **Step 1: Update the test helper and write failing tests**

In `web/src/test/buildSequence.test.ts`:

(a) Add `layout: 'group'` to the object returned by `makePhotos` (after `focalY: 0.5,`):

```ts
    focalX: 0.5,
    focalY: 0.5,
    layout: 'group',
```

(b) Add a new `describe` block at the end of the file:

```ts
describe('buildSequence — layout grouping', () => {
  const withLayout = (photos: Photo[], soloIds: string[]): Photo[] =>
    photos.map((p) => ({ ...p, layout: soloIds.includes(p.id) ? 'solo' : 'group' }));

  it('never places a solo photo in duo/triptych/polaroid', () => {
    const photos = withLayout(makePhotos(12), ['c1', 'c2', 'c3']);
    const soloIds = new Set(['c1', 'c2', 'c3']);
    const seq = buildSequence(photos, [], 'celebration', event);
    for (const s of seq) {
      if (s.type === 'duo' || s.type === 'triptych' || s.type === 'polaroid') {
        for (const p of (s as { photos: Photo[] }).photos) {
          expect(soloIds.has(p.id)).toBe(false);
        }
      }
    }
  });

  it('shows a solo photo as a full-screen hero', () => {
    const photos = withLayout(makePhotos(12), ['c1']);
    const seq = buildSequence(photos, [], 'celebration', event);
    const heroWithC1 = seq.some((s) => s.type === 'hero' && (s as { photos: Photo[] }).photos[0]!.id === 'c1');
    expect(heroWithC1).toBe(true);
  });

  it('covers every photo even with a mix of solo and group', () => {
    const photos = withLayout(makePhotos(9), ['c1', 'c2', 'c3', 'c4']);
    const seq = buildSequence(photos, [], 'celebration', event);
    const shown = new Set<string>();
    for (const s of seq) if ('photos' in s) s.photos.forEach((p) => shown.add(p.id));
    photos.forEach((p) => expect(shown.has(p.id)).toBe(true));
  });

  it('still pairs group photos in a duo', () => {
    const photos = withLayout(makePhotos(12), []); // all group
    const seq = buildSequence(photos, [], 'celebration', event);
    expect(seq.some((s) => s.type === 'duo')).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm --prefix web run test -- --run buildSequence`
Expected: FAIL — the "never places a solo photo …" test fails (solo photos currently land in duos).

- [ ] **Step 3: Rewrite `buildSequence`**

Replace the entire body of `web/src/lib/buildSequence.ts` with (the `CELEBRATION_PATTERN`, `REMEMBRANCE_PATTERN`, and `MAX_ITERATIONS` constants are unchanged — keep them as they are):

```ts
import type { Event, Message, Mode, Photo, SlideSpec } from '../types';

type PatternToken = 'hero' | 'duo' | 'hero-msg' | 'triptych' | 'polaroid' | 'message';

const CELEBRATION_PATTERN: PatternToken[] = [
  'hero',
  'duo',
  'hero-msg',
  'triptych',
  'hero',
  'polaroid',
  'duo',
  'message',
  'hero-msg',
  'hero',
  'duo',
  'message',
];

const REMEMBRANCE_PATTERN: PatternToken[] = [
  'hero',
  'hero-msg',
  'duo',
  'message',
  'hero',
  'duo',
  'hero-msg',
  'hero',
  'message',
];

const MAX_ITERATIONS = 200;

export function buildSequence(
  photos: Photo[],
  messages: Message[],
  mode: Mode,
  event: Event | null,
): SlideSpec[] {
  if (photos.length === 0) return [];

  const pattern = mode === 'celebration' ? CELEBRATION_PATTERN : REMEMBRANCE_PATTERN;
  const seq: SlideSpec[] = [];

  const photoIds = new Set(photos.map((p) => p.id));
  const msgByPhoto = new Map<string, Message>();
  const standalone: Message[] = [];
  for (const m of messages) {
    if (m.photoId && photoIds.has(m.photoId)) msgByPhoto.set(m.photoId, m);
    else standalone.push(m);
  }
  const paired = photos.filter((p) => msgByPhoto.has(p.id));
  const plain = photos.filter((p) => !msgByPhoto.has(p.id));
  // Only group photos may be cropped into a column; solo photos go full-screen.
  const plainGroup = plain.filter((p) => p.layout !== 'solo');
  const plainSolo = plain.filter((p) => p.layout === 'solo');

  if (event) {
    seq.push({ id: 'title-0', type: 'title-card', event });
  }

  let pairedI = 0;
  let groupI = 0;
  let soloI = 0;
  let standI = 0;
  let pairedUsed = 0;
  let groupUsed = 0;
  let soloUsed = 0;
  let standUsed = 0;
  let ti = 0;
  let safety = 0;

  const nextPaired = (): Photo => {
    const p = paired[pairedI % paired.length]!;
    pairedI += 1;
    if (pairedUsed < paired.length) pairedUsed += 1;
    return p;
  };
  const nextGroup = (): Photo => {
    const p = plainGroup[groupI % plainGroup.length]!;
    groupI += 1;
    if (groupUsed < plainGroup.length) groupUsed += 1;
    return p;
  };
  const nextSolo = (): Photo => {
    const p = plainSolo[soloI % plainSolo.length]!;
    soloI += 1;
    if (soloUsed < plainSolo.length) soloUsed += 1;
    return p;
  };
  const nextStandalone = (): Message => {
    const m = standalone[standI % standalone.length]!;
    standI += 1;
    if (standUsed < standalone.length) standUsed += 1;
    return m;
  };

  // Prefer a solo photo (so it gets its full-screen moment) then fall back to group.
  const hasAnyPlain = (): boolean => plainSolo.length > 0 || plainGroup.length > 0;
  const nextAnyPlain = (): Photo => (plainSolo.length > 0 ? nextSolo() : nextGroup());

  const emitSingle = (photo: Photo): void => {
    const msg = msgByPhoto.get(photo.id);
    if (msg) {
      seq.push({ id: `s${ti}-${photo.id}-msg`, type: 'hero-msg', photos: [photo], message: msg });
    } else {
      seq.push({ id: `s${ti}-${photo.id}`, type: 'hero', photos: [photo] });
    }
  };

  const done = (): boolean =>
    pairedUsed >= paired.length &&
    groupUsed >= plainGroup.length &&
    soloUsed >= plainSolo.length &&
    standUsed >= standalone.length;

  while (!done() && safety < MAX_ITERATIONS) {
    safety += 1;

    if (event && ti > 0 && ti % pattern.length === 0) {
      seq.push({ id: `title-${ti}`, type: 'title-card', event });
    }

    const token = pattern[ti % pattern.length]!;

    if (token === 'hero') {
      if (plainSolo.length > 0) emitSingle(nextSolo());
      else if (plainGroup.length > 0) emitSingle(nextGroup());
      else if (paired.length > 0) emitSingle(nextPaired());
    } else if (token === 'hero-msg') {
      if (paired.length > 0) {
        emitSingle(nextPaired());
      } else if (hasAnyPlain()) {
        const p = nextAnyPlain();
        seq.push({ id: `s${ti}-${p.id}-msg`, type: 'hero-msg', photos: [p], message: null });
      }
    } else if (token === 'duo') {
      if (plainGroup.length > 0) {
        const a = nextGroup();
        const b = nextGroup();
        seq.push({ id: `s${ti}-${a.id}-${b.id}`, type: 'duo', photos: [a, b] });
      } else if (plainSolo.length > 0) {
        emitSingle(nextSolo());
      } else if (paired.length > 0) {
        emitSingle(nextPaired());
      }
    } else if (token === 'triptych') {
      if (plainGroup.length > 0) {
        const a = nextGroup();
        const b = nextGroup();
        const c = nextGroup();
        seq.push({ id: `s${ti}-${a.id}-${b.id}-${c.id}`, type: 'triptych', photos: [a, b, c] });
      } else if (plainSolo.length > 0) {
        emitSingle(nextSolo());
      } else if (paired.length > 0) {
        emitSingle(nextPaired());
      }
    } else if (token === 'polaroid') {
      if (plainGroup.length > 0) {
        const a = nextGroup();
        const b = nextGroup();
        const c = nextGroup();
        seq.push({
          id: `s${ti}-${a.id}-${b.id}-${c.id}-pol`,
          type: 'polaroid',
          photos: [a, b, c],
        });
      } else if (plainSolo.length > 0) {
        emitSingle(nextSolo());
      } else if (paired.length > 0) {
        emitSingle(nextPaired());
      }
    } else {
      // 'message'
      if (standalone.length > 0) {
        const m = nextStandalone();
        seq.push({ id: `s${ti}-msg-${m.id}`, type: 'message', message: m });
      } else if (hasAnyPlain()) {
        emitSingle(nextAnyPlain());
      } else if (paired.length > 0) {
        emitSingle(nextPaired());
      }
    }

    ti += 1;
  }

  return seq;
}
```

- [ ] **Step 4: Run the full buildSequence suite (new + existing)**

Run: `npm --prefix web run test -- --run buildSequence`
Expected: PASS — including all pre-existing tests (with no solo photos, `plainGroup === plain`, so behavior is unchanged).

- [ ] **Step 5: Typecheck and commit**

Run: `npm --prefix web run typecheck`
Expected: no errors.

```bash
git add web/src/lib/buildSequence.ts web/src/test/buildSequence.test.ts
git commit -m "$(printf 'feat(web): keep solo photos out of grouping slides\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

## Task 9: Admin UI — grid badge + Auto/Group/Solo control

**Files:**
- Modify: `web/src/components/FocalEditor.tsx`
- Modify: `web/src/AdminApp.tsx`
- Test: `web/src/test/FocalEditor.test.tsx`, `web/src/test/AdminApp.test.tsx`

- [ ] **Step 1: Write the failing FocalEditor test**

In `web/src/test/FocalEditor.test.tsx`:

(a) Add the new fields to the `photo` fixture (after `focalSource: 'detected',`):

```ts
  focalSource: 'detected', width: 900, height: 600, faceCount: 3, layoutOverride: null, layout: 'group',
```

(b) Add a `noopLayout` helper near `noop`:

```ts
function noopLayout() { return Promise.resolve(); }
```

(c) Add a test:

```ts
  it('clicking a layout button calls onSetLayout with that value', () => {
    const onSetLayout = vi.fn(noopLayout);
    render(<FocalEditor photo={photo} onSave={noop} onRecalculate={noRecalc} onSetLayout={onSetLayout} onClose={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /^solo$/i }));
    expect(onSetLayout).toHaveBeenCalledWith('solo');
    fireEvent.click(screen.getByRole('button', { name: /^auto$/i }));
    expect(onSetLayout).toHaveBeenCalledWith(null);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm --prefix web run test -- --run FocalEditor`
Expected: FAIL — no button named "Solo".

- [ ] **Step 3: Add the control to FocalEditor**

In `web/src/components/FocalEditor.tsx`:

(a) Import `Layout`:

```ts
import type { AdminPhoto, Layout } from '../types';
```

(b) Add `onSetLayout` to the props interface:

```ts
interface FocalEditorProps {
  photo: AdminPhoto;
  onSave: (focalX: number, focalY: number) => Promise<void>;
  onRecalculate: () => Promise<{ focalX: number; focalY: number }>;
  onSetLayout: (layout: Layout | null) => Promise<void>;
  onClose: () => void;
}
```

(c) Destructure it:

```ts
export function FocalEditor({ photo, onSave, onRecalculate, onSetLayout, onClose }: FocalEditorProps) {
```

(d) Add the control inside the right-hand button column, immediately before the "Reset to center" button (i.e., as the first child of the `<div className="mt-auto flex flex-col gap-2">`):

```tsx
            <div role="group" aria-label="Slide layout">
              <p className="mono mb-1 text-[0.6rem] uppercase tracking-wide text-neutral-400">
                Layout · shown {photo.layout === 'solo' ? 'full-screen' : 'grouped'}
              </p>
              <div className="flex overflow-hidden rounded border border-neutral-700 mono text-xs">
                {([['Auto', null], ['Group', 'group'], ['Solo', 'solo']] as const).map(([label, value]) => (
                  <button
                    key={label}
                    type="button"
                    onClick={() => onSetLayout(value)}
                    className={`flex-1 py-2 ${
                      (photo.layoutOverride ?? null) === value
                        ? 'bg-neutral-100 text-neutral-900'
                        : 'text-neutral-300'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm --prefix web run test -- --run FocalEditor`
Expected: PASS.

- [ ] **Step 5: Write the failing AdminApp tests**

In `web/src/test/AdminApp.test.tsx`:

(a) Import `Layout` and `setPhotoLayout` usage — extend the `photo` factory to accept layout fields:

```ts
const photo = (id: string, hidden = false, layout: 'group' | 'solo' = 'group', layoutOverride: 'group' | 'solo' | null = null): AdminPhoto => ({
  id, eventId: 'remembrance', source: 'seed', url: `/${id}.jpg`,
  url1024: `/${id}-1024.jpg`, url320: `/${id}-320.jpg`, credit: 'C', createdAt: 0, hidden,
  focalX: 0.5, focalY: 0.5, focalSource: 'unknown',
  width: 0, height: 0, faceCount: 0, layout, layoutOverride,
});
```

(b) Add a test inside `describe('AdminApp curation', …)`. Override the photos mock for this test to include a solo photo:

```ts
  it('shows a layout badge per photo', async () => {
    vi.spyOn(adminApi, 'fetchAdminPhotos').mockResolvedValue([photo('p1'), photo('p9', false, 'solo')]);
    render(<AdminApp />);
    await screen.findAllByRole('img');
    expect(screen.getByText('Solo')).toBeInTheDocument();
    expect(screen.getAllByText('Group').length).toBeGreaterThanOrEqual(1);
  });
```

- [ ] **Step 6: Run test to verify it fails**

Run: `npm --prefix web run test -- --run AdminApp`
Expected: FAIL — no element with text "Solo".

- [ ] **Step 7: Add the badge + handler to AdminApp**

In `web/src/AdminApp.tsx`:

(a) Add `setPhotoLayout` to the import from `'./lib/adminApi'`, and add `Layout` to the type import from `'./types'`.

(b) Add the handler next to `onSaveFocal`/`onRecalcFocal`:

```ts
  const onSetLayout = async (layout: Layout | null) => {
    if (!event || !editingId) return;
    const resolved = await setPhotoLayout(event.id, editingId, layout, token);
    setPhotos((cur) =>
      cur.map((x) => (x.id === editingId ? { ...x, layoutOverride: layout, layout: resolved } : x)),
    );
  };
```

(c) Add the badge inside the thumbnail button, after the existing Seed/Guest `<span>` (around line 254):

```tsx
                <span className="absolute top-1 right-1 mono text-[0.55rem] uppercase tracking-wide px-1.5 py-0.5 rounded bg-black/60">
                  {p.layout === 'solo' ? 'Solo' : 'Group'}{p.layoutOverride ? ' ·' : ''}
                </span>
```

(d) Pass `onSetLayout` to the editor:

```tsx
        <FocalEditor
          photo={editing}
          onSave={onSaveFocal}
          onRecalculate={onRecalcFocal}
          onSetLayout={onSetLayout}
          onClose={() => setEditingId(null)}
        />
```

- [ ] **Step 8: Run the web UI tests**

Run: `npm --prefix web run test -- --run AdminApp FocalEditor`
Expected: PASS.

- [ ] **Step 9: Typecheck and commit**

Run: `npm --prefix web run typecheck`
Expected: no errors.

```bash
git add web/src/components/FocalEditor.tsx web/src/AdminApp.tsx web/src/test/FocalEditor.test.tsx web/src/test/AdminApp.test.tsx
git commit -m "$(printf 'feat(web): admin layout badge and Auto/Group/Solo override control\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

## Task 10: Full verification + roadmap entry

**Files:**
- Modify: `../mosaic-specs/roadmap.md` (add a v0.11 Draft entry)

- [ ] **Step 1: Run the entire API + web suites and both typechecks**

```bash
npm --prefix api run test -- --run
npm --prefix web run test -- --run
npm --prefix api run typecheck
npm --prefix web run typecheck
```
Expected: all green. If anything fails, fix it before continuing — do not edit tests to pass unless the test itself is wrong.

- [ ] **Step 2: Add the roadmap entry**

In `../mosaic-specs/roadmap.md`, add this block immediately after the `## v0.10 — Remembrance music` section and before `## Backlog …`:

```markdown
## v0.11 — Layout-aware photo grouping

**Status:** Draft — 2026-06-06
**Spec:** [`v0.11-layout-aware-photo-grouping-spec.md`](v0.11-layout-aware-photo-grouping-spec.md)

Auto-classify each photo as `group` (safe to crop into a duo/triptych/polaroid
column) or `solo` (full-screen only) from orientation + detected face count,
stored as `width`/`height`/`face_count`/`layout_override` on `photos`. A boot
backfill classifies existing photos. Admins override per-photo (Auto/Group/Solo)
in the focal editor. Landscape group shots stop getting their faces cropped.

**Out of scope:** a stacked-landscape slide layout; per-event threshold config.

---
```

- [ ] **Step 3: Commit the roadmap (in the specs repo)**

```bash
cd ../mosaic-specs
git add roadmap.md
git commit -m "$(printf 'docs: add v0.11 layout-aware photo grouping to roadmap\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
cd -
```

- [ ] **Step 4: Manual smoke check (browser)**

Start the app (per the project's run instructions) and verify, as an admin:
- The admin grid shows a `Group`/`Solo` badge on each photo.
- Opening a photo's editor shows the Auto/Group/Solo control; setting `Solo` adds the `·` override marker on the grid badge and the wall stops pairing that photo.
- A freshly uploaded landscape group photo (3+ faces) appears full-screen, never in a duo/triptych/polaroid cell.

---

## Self-Review Notes

- **Spec coverage:** migration (T1) ✓; `resolveLayout` (T2) ✓; detection signals (T3) ✓; persistence + queries + upload (T4) ✓; public/admin API + override endpoint (T5) ✓; backfill + boot wiring (T6) ✓; web types/mappers/`setPhotoLayout` (T7) ✓; `buildSequence` split (T8) ✓; admin badge + override UI in FocalEditor (T9) ✓; tests + roadmap (T1–T10) ✓. The spec's "returns `{ ok: true }`" is implemented as `{ ok: true, layout }` so the client can update the resolved value after an Auto reset — the spec API section has been updated to match.
- **Type consistency:** `Layout = 'group' | 'solo'` defined once in `api/src/types.ts` and once in `web/src/types.ts` (no cross-package import). `resolveLayout({ width, height, faceCount, override })`, `updatePhotoLayoutOverride`, `updatePhotoLayoutSignals`, `setPhotoLayout`, `onSetLayout`, `layoutOverride`/`layout_override` used consistently across tasks.
- **No placeholders:** every code/test step contains complete content.
```
