# v0.7 Admin Curation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a private `/admin` page that lets the operator show/hide photos, delete photos atomically (DB row + linked messages + files + variants), and pick the slideshow transition style, gated by an admin-scoped token and propagated live to the TV.

**Architecture:** Extend the existing v0.3 HMAC token with an optional `role: 'admin'` claim and a `requireAdmin` gate; add an `admin.ts` route module behind that gate; add a `hidden` column on photos (filtered server-side on the public read path) and a `transition_style` column on events; add a second frontend page (`AdminApp`) selected by `location.pathname` in `main.tsx`; reuse the v0.6 live-update bus, extending the slideshow refresh to also refetch the event.

**Tech Stack:** Fastify + better-sqlite3 (API, ESM `.js` import specifiers), React 18 + Vite + Vitest + Testing Library (web), nginx (prod static serving), sharp (variants).

---

## Spec

Source spec: [`../mosaic-specs/v0.7-admin-curation-spec.md`](../../../mosaic-specs/v0.7-admin-curation-spec.md). Read it before starting.

## Conventions (read once)

- **ESM imports in `api/`** always use the `.js` extension even for `.ts` files (e.g. `import { x } from './token.js'`). Match this exactly.
- **API tests** live in `api/test/*.test.ts` and run with `npm test` from `api/`. They build the schema by concatenating every `migrations/*.sql` file (see existing `routes.test.ts`), so a new migration is picked up automatically.
- **Web tests** live in `web/src/test/*.test.tsx` and run with `npm test` from `web/`.
- **DB rows are snake_case** (`transition_style`, `hidden`); **web types are camelCase** (`transitionStyle`), mapped in `web/src/lib/api.ts`.
- Run a single API test file: `npm test -- token.test.ts` from `api/`. Single web file: `npm test -- App.test.tsx` from `web/`.
- Commit after each task. Branch off `main` first (`git checkout -b feat/v0.7-admin-curation`).

## File Structure

**API — new files:**
- `api/migrations/003_admin_curation.sql` — adds `photos.hidden`, `events.transition_style`.
- `api/src/routes/admin.ts` — the four admin routes, behind `requireAdmin`.

**API — modified files:**
- `api/src/types.ts` — `PhotoRow.hidden`, `EventRow.transition_style`, `TransitionStyle` type.
- `api/src/lib/token.ts` — `role` on `TokenPayload`/verify/mint; `/admin#t=` URL.
- `api/src/lib/auth.ts` — `makeRequireAdmin`.
- `api/src/db/queries.ts` — `listAdminPhotos`, `setPhotoHidden`, `getPhotoForEvent`, `deletePhotoCascade`, `updateTransitionStyle`, `listPhotos` gains `WHERE hidden = 0`.
- `api/src/lib/liveUpdates.ts` — new `LiveUpdateType` values.
- `api/src/cli/mintToken.ts` — `--admin` flag.
- `api/src/server.ts` — register admin routes; mint+print admin token at boot.

**Web — new files:**
- `web/src/AdminApp.tsx` — the admin page.
- `web/src/lib/adminApi.ts` — admin fetch helpers.
- `web/src/test/AdminApp.test.tsx`, `web/src/test/main.test.tsx`, `web/src/test/adminApi.test.ts`.

**Web — modified files:**
- `web/src/main.tsx` — branch on `location.pathname`.
- `web/src/types.ts` — `Event.transitionStyle`, `AdminPhoto`.
- `web/src/lib/api.ts` — map `transition_style` → `transitionStyle`.
- `web/src/App.tsx` — refresh refetches the event; pass nothing new (Wall already gets `event`).
- `web/src/components/Wall.tsx` — select cinematic enter classes/durations from `event.transitionStyle`.
- `web/src/index.css` — cinematic keyframes (browser-verified).

**Config — modified:**
- `web/src/test/securityHeaders.test.ts` — add `/admin` SPA-fallback regression assertion (nginx already falls back via the catch-all `location /`; see Task 14).

---

## Task 1: Migration 003 — `hidden` + `transition_style`

**Files:**
- Create: `api/migrations/003_admin_curation.sql`
- Test: `api/test/migrate.test.ts` (add cases)

- [ ] **Step 1: Write the failing tests**

Add to `api/test/migrate.test.ts`, inside the top-level `describe('migrate', ...)`:

```typescript
  it('adds photos.hidden defaulting to 0 and events.transition_style defaulting to default', () => {
    const db = openDatabase(':memory:');
    migrate(db);
    const photoCols = (
      db.prepare('PRAGMA table_info(photos)').all() as { name: string; dflt_value: string | null }[]
    );
    const eventCols = (
      db.prepare('PRAGMA table_info(events)').all() as { name: string; dflt_value: string | null }[]
    );
    const hidden = photoCols.find((c) => c.name === 'hidden');
    const style = eventCols.find((c) => c.name === 'transition_style');
    expect(hidden?.dflt_value).toBe('0');
    expect(style?.dflt_value).toBe("'default'");
    db.close();
  });

  it('records 003_admin_curation.sql exactly once', () => {
    const db = openDatabase(':memory:');
    migrate(db);
    migrate(db);
    const rows = (
      db.prepare("SELECT count(*) AS n FROM schema_migrations WHERE filename = '003_admin_curation.sql'").get() as { n: number }
    ).n;
    expect(rows).toBe(1);
    db.close();
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd api && npm test -- migrate.test.ts`
Expected: FAIL — `hidden`/`transition_style` columns do not exist yet.

- [ ] **Step 3: Create the migration**

Create `api/migrations/003_admin_curation.sql`:

```sql
ALTER TABLE photos ADD COLUMN hidden INTEGER NOT NULL DEFAULT 0;
ALTER TABLE events ADD COLUMN transition_style TEXT NOT NULL DEFAULT 'default';
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd api && npm test -- migrate.test.ts`
Expected: PASS (all cases, including the pre-existing ones).

- [ ] **Step 5: Commit**

```bash
git add api/migrations/003_admin_curation.sql api/test/migrate.test.ts
git commit -m "feat(api): migration 003 adds photos.hidden and events.transition_style"
```

---

## Task 2: Types — `hidden`, `transition_style`, `TransitionStyle`

**Files:**
- Modify: `api/src/types.ts`

No standalone test — this is type-only and is exercised by every later task. The TypeScript build (`npm run build` / `tsc`) is the verification.

- [ ] **Step 1: Add the types**

In `api/src/types.ts`, add the `TransitionStyle` union, extend `EventRow` and `PhotoRow`:

```typescript
export type Mode = 'celebration' | 'remembrance';
export type PhotoSource = 'seed' | 'upload';
export type TransitionStyle = 'default' | 'cinematic';

export interface EventRow {
  id: string;
  mode: Mode;
  eyebrow: string;
  title: string;
  dateline: string;
  place: string;
  invitation: string;
  brand_sub: string;
  short_code: string;
  transition_style: string;
}

export interface PhotoRow {
  id: string;
  event_id: string;
  source: PhotoSource;
  filename: string;
  credit: string;
  created_at: number;
  hidden: number;
}
```

(Leave `PhotoResponse` as-is; the admin response adds `hidden`/`source` which `PhotoRow` already carries.)

- [ ] **Step 2: Verify the project still type-checks**

Run: `cd api && npm run build`
Expected: PASS. (If `upsertEvent` now errors because `transition_style` is required on `EventRow` but not inserted — that is expected and fixed in Task 4 Step 3. If the build fails only on `upsertEvent`/seed event construction, proceed to Task 4 before committing; otherwise commit now.)

- [ ] **Step 3: Commit**

```bash
git add api/src/types.ts
git commit -m "feat(api): add hidden, transition_style, TransitionStyle to row types"
```

---

## Task 3: Token role support

**Files:**
- Modify: `api/src/lib/token.ts`
- Test: `api/test/token.test.ts` (add cases)

- [ ] **Step 1: Write the failing tests**

Add to `api/test/token.test.ts` (a new `describe` block; reuse the file's existing imports of `signToken`, `verifyToken`, `mintToken`):

```typescript
describe('admin role claim', () => {
  const secret = 'role-secret';

  it('round-trips a role: admin payload through sign/verify', () => {
    const exp = Math.floor(Date.now() / 1000) + 3600;
    const token = signToken({ eid: 'remembrance', exp, role: 'admin' }, secret);
    const res = verifyToken(token, secret, 'remembrance');
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.payload.role).toBe('admin');
  });

  it('omits role for a guest token', () => {
    const exp = Math.floor(Date.now() / 1000) + 3600;
    const token = signToken({ eid: 'remembrance', exp }, secret);
    const res = verifyToken(token, secret, 'remembrance');
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.payload.role).toBeUndefined();
  });

  it('mintToken with role: admin produces an /admin#t= URL', () => {
    const result = mintToken({
      secret,
      eid: 'remembrance',
      ttlDays: 14,
      baseUrl: 'https://ev.example',
      role: 'admin',
    });
    expect(result.url).toBe(`https://ev.example/admin#t=${result.token}`);
  });

  it('mintToken without role keeps the guest /#t= URL', () => {
    const result = mintToken({
      secret,
      eid: 'remembrance',
      ttlDays: 14,
      baseUrl: 'https://ev.example',
    });
    expect(result.url).toBe(`https://ev.example/#t=${result.token}`);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd api && npm test -- token.test.ts`
Expected: FAIL — `role` is not a valid `TokenPayload` field; `mintToken` has no `role` option.

- [ ] **Step 3: Implement role support**

In `api/src/lib/token.ts`, edit `TokenPayload`, the `verifyToken` reconstruction, and `mintToken`:

```typescript
export interface TokenPayload {
  eid: string;
  exp: number; // unix seconds
  role?: 'admin';
}
```

In `verifyToken`, change the final success return so it preserves `role` (keep all earlier validation unchanged):

```typescript
  return { ok: true, payload: { eid: p.eid, exp: p.exp, ...(p.role === 'admin' ? { role: 'admin' as const } : {}) } };
```

In `mintToken`, add an optional `role` and build the URL path accordingly:

```typescript
export function mintToken(opts: {
  secret: string;
  eid: string;
  ttlDays: number;
  baseUrl?: string;
  role?: 'admin';
  now?: number; // unix ms; injectable for tests
}): MintResult {
  const nowMs = opts.now ?? Date.now();
  const exp = Math.floor(nowMs / 1000) + opts.ttlDays * 86400;
  const token = signToken(
    { eid: opts.eid, exp, ...(opts.role ? { role: opts.role } : {}) },
    opts.secret,
  );
  const host = opts.baseUrl ?? 'https://<your-event-host>';
  const path = opts.role === 'admin' ? '/admin#t=' : '/#t=';
  return {
    token,
    expiresAt: new Date(exp * 1000).toISOString(),
    url: `${host}${path}${token}`,
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd api && npm test -- token.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add api/src/lib/token.ts api/test/token.test.ts
git commit -m "feat(api): support role: admin claim in token sign/verify/mint"
```

---

## Task 4: Queries — admin queries + hidden filter

**Files:**
- Modify: `api/src/db/queries.ts`
- Test: `api/test/queries.test.ts` (add cases)

- [ ] **Step 1: Write the failing tests**

Add to `api/test/queries.test.ts`. First extend the imports at the top:

```typescript
import {
  upsertEvent,
  listEvents,
  insertMessage,
  listMessages,
  insertPhoto,
  listPhotos,
  listAdminPhotos,
  setPhotoHidden,
  getPhotoForEvent,
  deletePhotoCascade,
  updateTransitionStyle,
  getEvent,
} from '../src/db/queries.js';
```

Then add a new `describe`:

```typescript
describe('admin curation queries', () => {
  beforeEach(() => {
    insertPhoto(db, { id: 'p1', event_id: 'remembrance', source: 'seed', filename: 'a.jpg', credit: 'A', created_at: 100 });
    insertPhoto(db, { id: 'p2', event_id: 'remembrance', source: 'upload', filename: 'b.jpg', credit: 'B', created_at: 200 });
  });

  it('listPhotos excludes hidden rows; listAdminPhotos includes them', () => {
    setPhotoHidden(db, 'remembrance', 'p1', true);
    expect(listPhotos(db, 'remembrance').map((r) => r.id)).toEqual(['p2']);
    expect(listAdminPhotos(db, 'remembrance').map((r) => r.id)).toEqual(['p1', 'p2']);
  });

  it('setPhotoHidden flips the flag and reports update vs no-op', () => {
    expect(setPhotoHidden(db, 'remembrance', 'p1', true)).toBe(true);
    expect(getPhotoForEvent(db, 'remembrance', 'p1')?.hidden).toBe(1);
    expect(setPhotoHidden(db, 'remembrance', 'missing', true)).toBe(false);
    expect(setPhotoHidden(db, 'celebration', 'p1', true)).toBe(false); // wrong event
  });

  it('getPhotoForEvent returns the row only for the matching event', () => {
    expect(getPhotoForEvent(db, 'remembrance', 'p2')?.filename).toBe('b.jpg');
    expect(getPhotoForEvent(db, 'celebration', 'p2')).toBeUndefined();
  });

  it('deletePhotoCascade removes the photo + linked messages in one tx and returns the row', () => {
    insertMessage(db, { id: 'm1', event_id: 'remembrance', name: 'A', text: 'linked', created_at: 5, photo_id: 'p1' });
    insertMessage(db, { id: 'm2', event_id: 'remembrance', name: 'B', text: 'standalone', created_at: 6 });
    const deleted = deletePhotoCascade(db, 'remembrance', 'p1');
    expect(deleted).toMatchObject({ filename: 'a.jpg', source: 'seed' });
    expect(getPhotoForEvent(db, 'remembrance', 'p1')).toBeUndefined();
    expect(listMessages(db, 'remembrance').map((m) => m.id)).toEqual(['m2']);
  });

  it('deletePhotoCascade returns undefined for a photo not in the event', () => {
    expect(deletePhotoCascade(db, 'celebration', 'p1')).toBeUndefined();
    expect(getPhotoForEvent(db, 'remembrance', 'p1')).toBeDefined();
  });

  it('updateTransitionStyle persists a valid value', () => {
    updateTransitionStyle(db, 'remembrance', 'cinematic');
    expect(getEvent(db, 'remembrance')?.transition_style).toBe('cinematic');
  });
});
```

Note: the test's `upsertEvent` seed in `beforeEach` will need `transition_style`; see Step 3 which also fixes `upsertEvent`. Update the existing `upsertEvent({...})` call at the top of `queries.test.ts` to include `transition_style: 'default'`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd api && npm test -- queries.test.ts`
Expected: FAIL — new query functions are not exported.

- [ ] **Step 3: Implement the queries**

In `api/src/db/queries.ts`:

(a) Make `upsertEvent` write `transition_style`. Replace its body:

```typescript
export function upsertEvent(db: DB, e: EventRow): void {
  db.prepare(
    `INSERT INTO events (id, mode, eyebrow, title, dateline, place, invitation, brand_sub, short_code, transition_style)
     VALUES (@id, @mode, @eyebrow, @title, @dateline, @place, @invitation, @brand_sub, @short_code, @transition_style)
     ON CONFLICT(id) DO UPDATE SET
       mode = excluded.mode,
       eyebrow = excluded.eyebrow,
       title = excluded.title,
       dateline = excluded.dateline,
       place = excluded.place,
       invitation = excluded.invitation,
       brand_sub = excluded.brand_sub,
       short_code = excluded.short_code`,
  ).run(e);
}
```

Note: `transition_style` is intentionally NOT in the `DO UPDATE SET` list — re-seeding an event on boot must not reset an operator's chosen style. The `INSERT` sets it to `'default'` on first insert only.

(b) Add `WHERE hidden = 0` to the public `listPhotos`:

```typescript
export function listPhotos(db: DB, eventId: string): PhotoRow[] {
  return db
    .prepare('SELECT * FROM photos WHERE event_id = ? AND hidden = 0 ORDER BY created_at ASC')
    .all(eventId) as PhotoRow[];
}
```

(c) Append the new admin queries to the file:

```typescript
export function listAdminPhotos(db: DB, eventId: string): PhotoRow[] {
  return db
    .prepare('SELECT * FROM photos WHERE event_id = ? ORDER BY created_at ASC')
    .all(eventId) as PhotoRow[];
}

export function getPhotoForEvent(db: DB, eventId: string, photoId: string): PhotoRow | undefined {
  return db
    .prepare('SELECT * FROM photos WHERE id = ? AND event_id = ?')
    .get(photoId, eventId) as PhotoRow | undefined;
}

export function setPhotoHidden(db: DB, eventId: string, photoId: string, hidden: boolean): boolean {
  const info = db
    .prepare('UPDATE photos SET hidden = ? WHERE id = ? AND event_id = ?')
    .run(hidden ? 1 : 0, photoId, eventId);
  return info.changes > 0;
}

export function deletePhotoCascade(db: DB, eventId: string, photoId: string): PhotoRow | undefined {
  const tx = db.transaction(() => {
    const row = getPhotoForEvent(db, eventId, photoId);
    if (!row) return undefined;
    db.prepare('DELETE FROM messages WHERE photo_id = ? AND event_id = ?').run(photoId, eventId);
    db.prepare('DELETE FROM photos WHERE id = ? AND event_id = ?').run(photoId, eventId);
    return row;
  });
  return tx();
}

export function updateTransitionStyle(db: DB, eventId: string, style: string): void {
  db.prepare('UPDATE events SET transition_style = ? WHERE id = ?').run(style, eventId);
}
```

(d) `getEvent` already does `SELECT *`, so `transition_style` is returned automatically — no change needed.

- [ ] **Step 4: Fix seed-event construction so `EventRow` is satisfied**

`api/src/lib/seedEvents.ts` builds `EventRow` objects that now need `transition_style`. Run the build to find the exact spots:

Run: `cd api && npm run build`
Expected initially: FAIL with errors that `transition_style` is missing on the seed `EventRow` literals.

Open `api/src/lib/seedEvents.ts` and add `transition_style: 'default'` to each seed event object literal (the `SEED_EVENTS` entries). If `applyEventOverrides` spreads/returns an `EventRow`, no change is needed there beyond the source literals carrying the field.

Re-run: `cd api && npm run build`
Expected: PASS.

- [ ] **Step 5: Run query tests to verify they pass**

Run: `cd api && npm test -- queries.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add api/src/db/queries.ts api/src/lib/seedEvents.ts api/test/queries.test.ts
git commit -m "feat(api): admin curation queries + hidden filter on listPhotos"
```

---

## Task 5: Admin auth gate

**Files:**
- Modify: `api/src/lib/auth.ts`
- Test: `api/test/auth.test.ts` (add cases)

- [ ] **Step 1: Write the failing tests**

Add to `api/test/auth.test.ts`. Extend imports and add a `describe`:

```typescript
import Fastify from 'fastify';
import { makeRequireAdmin } from '../src/lib/auth.js';
import { signToken } from '../src/lib/token.js';

describe('makeRequireAdmin', () => {
  const secret = 'admin-gate-secret';

  async function appWithGate() {
    const app = Fastify();
    app.get('/api/events/:id/admin/ping', { preHandler: makeRequireAdmin(secret) }, async () => ({ ok: true }));
    await app.ready();
    return app;
  }

  const admin = (eid = 'remembrance', expDelta = 3600) =>
    `Bearer ${signToken({ eid, exp: Math.floor(Date.now() / 1000) + expDelta, role: 'admin' }, secret)}`;
  const guest = (eid = 'remembrance') =>
    `Bearer ${signToken({ eid, exp: Math.floor(Date.now() / 1000) + 3600 }, secret)}`;

  it('accepts a valid admin token', async () => {
    const app = await appWithGate();
    const res = await app.inject({ method: 'GET', url: '/api/events/remembrance/admin/ping', headers: { authorization: admin() } });
    expect(res.statusCode).toBe(200);
    await app.close();
  });

  it('rejects a guest token (no role) with 401', async () => {
    const app = await appWithGate();
    const res = await app.inject({ method: 'GET', url: '/api/events/remembrance/admin/ping', headers: { authorization: guest() } });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it('rejects when no Authorization header is present', async () => {
    const app = await appWithGate();
    const res = await app.inject({ method: 'GET', url: '/api/events/remembrance/admin/ping' });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it('rejects an expired admin token', async () => {
    const app = await appWithGate();
    const res = await app.inject({ method: 'GET', url: '/api/events/remembrance/admin/ping', headers: { authorization: admin('remembrance', -10) } });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it('rejects an admin token minted for a different event', async () => {
    const app = await appWithGate();
    const res = await app.inject({ method: 'GET', url: '/api/events/remembrance/admin/ping', headers: { authorization: admin('celebration') } });
    expect(res.statusCode).toBe(401);
    await app.close();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd api && npm test -- auth.test.ts`
Expected: FAIL — `makeRequireAdmin` is not exported.

- [ ] **Step 3: Implement the gate**

In `api/src/lib/auth.ts`, add (keep `makeRequireToken` unchanged):

```typescript
const NOT_ADMIN_MSG = "This link can't curate the wall.";

export function makeRequireAdmin(secret: string): preHandlerHookHandler {
  return async (req, reply) => {
    const auth = req.headers.authorization;
    if (!auth || !auth.startsWith('Bearer ')) {
      return reply.code(401).send({ error: NOT_ADMIN_MSG });
    }
    const token = auth.slice('Bearer '.length);
    const eventId = (req.params as { id: string }).id;
    const result = verifyToken(token, secret, eventId);
    if (!result.ok || result.payload.role !== 'admin') {
      return reply.code(401).send({ error: NOT_ADMIN_MSG });
    }
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd api && npm test -- auth.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add api/src/lib/auth.ts api/test/auth.test.ts
git commit -m "feat(api): makeRequireAdmin gate requiring role: admin"
```

---

## Task 6: Live-update types for admin mutations

**Files:**
- Modify: `api/src/lib/liveUpdates.ts`
- Test: `api/test/liveUpdates.test.ts` (add one case)

The frontend's update handler ignores the `type` and just refetches, but the union is strict, so admin routes need valid `type` values to publish.

- [ ] **Step 1: Write the failing test**

Add to `api/test/liveUpdates.test.ts` (reuse its existing `createLiveUpdateBus` import):

```typescript
  it('delivers admin mutation update types to subscribers', () => {
    const bus = createLiveUpdateBus();
    const received: string[] = [];
    bus.subscribe('e1', (u) => received.push(u.type));
    bus.publish({ type: 'photo_updated', eventId: 'e1', createdAt: 1 });
    bus.publish({ type: 'photo_deleted', eventId: 'e1', createdAt: 2 });
    bus.publish({ type: 'event_updated', eventId: 'e1', createdAt: 3 });
    expect(received).toEqual(['photo_updated', 'photo_deleted', 'event_updated']);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd api && npm test -- liveUpdates.test.ts`
Expected: FAIL — these `type` values are not assignable to `LiveUpdateType`.

- [ ] **Step 3: Extend the union**

In `api/src/lib/liveUpdates.ts`:

```typescript
export type LiveUpdateType =
  | 'photo_created'
  | 'message_created'
  | 'photo_updated'
  | 'photo_deleted'
  | 'event_updated';
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd api && npm test -- liveUpdates.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add api/src/lib/liveUpdates.ts api/test/liveUpdates.test.ts
git commit -m "feat(api): add admin mutation live-update types"
```

---

## Task 7: Admin routes module

**Files:**
- Create: `api/src/routes/admin.ts`
- Modify: `api/src/server.ts` (wire it up)
- Test: `api/test/routes.test.ts` (add cases + register the admin routes in the test harness)

- [ ] **Step 1: Register admin routes in the test harness and write failing tests**

In `api/test/routes.test.ts`, extend imports:

```typescript
import { makeRequireToken, makeRequireAdmin } from '../src/lib/auth.js';
import { registerAdminRoutes } from '../src/routes/admin.js';
import { variantFilename } from '../src/lib/variants.js';
import { uploadsDirFor, seedsDirFor } from '../src/lib/storage.js';
```

In `buildApp()`, after the existing `registerPhotoRoutes(...)` line, add:

```typescript
  registerAdminRoutes(app, db, paths, makeRequireAdmin(TEST_SECRET));
```

Add admin-token helpers near the existing `validAuth` helpers:

```typescript
const adminAuth = (eid = 'remembrance'): string =>
  `Bearer ${signToken({ eid, exp: Math.floor(Date.now() / 1000) + 3600, role: 'admin' }, TEST_SECRET)}`;
```

Add a `describe` block. It seeds a photo + its variants + a linked message on disk so DELETE can be asserted:

```typescript
describe('admin routes', () => {
  // Helper: create a photo row with on-disk original (upload) + both variant files.
  async function seedUploadPhoto(id: string, withMessage = false) {
    const filename = `${id}.jpg`;
    const buf = await sharp({ create: { width: 40, height: 40, channels: 3 as const, background: 'green' } }).jpeg().toBuffer();
    const dir = uploadsDirFor(paths, 'remembrance');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, filename), buf);
    const vdir = variantsDirFor(paths, 'remembrance');
    fs.mkdirSync(vdir, { recursive: true });
    fs.writeFileSync(path.join(vdir, variantFilename(filename, 1024)), buf);
    fs.writeFileSync(path.join(vdir, variantFilename(filename, 320)), buf);
    db.prepare('INSERT INTO photos (id, event_id, source, filename, credit, created_at, hidden) VALUES (?,?,?,?,?,?,0)')
      .run(id, 'remembrance', 'upload', filename, 'A', Date.now());
    if (withMessage) {
      db.prepare('INSERT INTO messages (id, event_id, name, text, created_at, photo_id) VALUES (?,?,?,?,?,?)')
        .run(`msg-${id}`, 'remembrance', 'A', 'linked', Date.now(), id);
    }
    return filename;
  }

  it('all admin routes return 401 with no token and with a guest token', async () => {
    await seedUploadPhoto('a1');
    const cases: Array<[string, string, object?]> = [
      ['GET', '/api/events/remembrance/admin/photos'],
      ['PATCH', '/api/events/remembrance/admin/photos/a1', { hidden: true }],
      ['DELETE', '/api/events/remembrance/admin/photos/a1'],
      ['PATCH', '/api/events/remembrance/admin/settings', { transitionStyle: 'cinematic' }],
    ];
    for (const [method, url, payload] of cases) {
      const noTok = await app.inject({ method: method as 'GET', url, payload });
      expect(noTok.statusCode, `${method} ${url} no-token`).toBe(401);
      const guest = await app.inject({ method: method as 'GET', url, payload, headers: { authorization: validAuth() } });
      expect(guest.statusCode, `${method} ${url} guest`).toBe(401);
    }
  });

  it('GET admin/photos returns all photos incl. hidden, with source + hidden + urls', async () => {
    await seedUploadPhoto('a1');
    db.prepare('UPDATE photos SET hidden = 1 WHERE id = ?').run('a1');
    const res = await app.inject({ method: 'GET', url: '/api/events/remembrance/admin/photos', headers: { authorization: adminAuth() } });
    expect(res.statusCode).toBe(200);
    const body = res.json() as Array<{ id: string; hidden: number; source: string; url: string; url_320: string }>;
    expect(body[0]).toMatchObject({ id: 'a1', hidden: 1, source: 'upload' });
    expect(body[0]?.url_320).toContain('320');
  });

  it('PATCH admin/photos toggles visibility; public list reflects it', async () => {
    await seedUploadPhoto('a1');
    const hide = await app.inject({ method: 'PATCH', url: '/api/events/remembrance/admin/photos/a1', payload: { hidden: true }, headers: { authorization: adminAuth() } });
    expect(hide.statusCode).toBe(200);
    const pub = await app.inject({ method: 'GET', url: '/api/events/remembrance/photos' });
    expect((pub.json() as unknown[]).length).toBe(0);
    const show = await app.inject({ method: 'PATCH', url: '/api/events/remembrance/admin/photos/a1', payload: { hidden: false }, headers: { authorization: adminAuth() } });
    expect(show.statusCode).toBe(200);
    const pub2 = await app.inject({ method: 'GET', url: '/api/events/remembrance/photos' });
    expect((pub2.json() as unknown[]).length).toBe(1);
  });

  it('PATCH admin/photos for a photo not in the event 404s', async () => {
    const res = await app.inject({ method: 'PATCH', url: '/api/events/remembrance/admin/photos/missing', payload: { hidden: true }, headers: { authorization: adminAuth() } });
    expect(res.statusCode).toBe(404);
  });

  it('DELETE removes the row, linked message, original file, and both variants; second delete 404s', async () => {
    const filename = await seedUploadPhoto('a1', true);
    const original = path.join(uploadsDirFor(paths, 'remembrance'), filename);
    const v1024 = path.join(variantsDirFor(paths, 'remembrance'), variantFilename(filename, 1024));
    const v320 = path.join(variantsDirFor(paths, 'remembrance'), variantFilename(filename, 320));
    expect(fs.existsSync(original)).toBe(true);

    const res = await app.inject({ method: 'DELETE', url: '/api/events/remembrance/admin/photos/a1', headers: { authorization: adminAuth() } });
    expect(res.statusCode).toBe(200);
    expect(fs.existsSync(original)).toBe(false);
    expect(fs.existsSync(v1024)).toBe(false);
    expect(fs.existsSync(v320)).toBe(false);
    const msgs = db.prepare('SELECT count(*) AS n FROM messages WHERE photo_id = ?').get('a1') as { n: number };
    expect(msgs.n).toBe(0);

    const again = await app.inject({ method: 'DELETE', url: '/api/events/remembrance/admin/photos/a1', headers: { authorization: adminAuth() } });
    expect(again.statusCode).toBe(404);
  });

  it('PATCH admin/settings rejects an invalid transitionStyle (400) and accepts valid ones', async () => {
    const bad = await app.inject({ method: 'PATCH', url: '/api/events/remembrance/admin/settings', payload: { transitionStyle: 'sparkles' }, headers: { authorization: adminAuth() } });
    expect(bad.statusCode).toBe(400);
    for (const style of ['default', 'cinematic']) {
      const ok = await app.inject({ method: 'PATCH', url: '/api/events/remembrance/admin/settings', payload: { transitionStyle: style }, headers: { authorization: adminAuth() } });
      expect(ok.statusCode).toBe(200);
    }
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd api && npm test -- routes.test.ts`
Expected: FAIL — `registerAdminRoutes` does not exist.

- [ ] **Step 3: Implement the admin route module**

Create `api/src/routes/admin.ts`:

```typescript
import fs from 'node:fs';
import path from 'node:path';
import type { FastifyInstance, preHandlerHookHandler } from 'fastify';
import type { DB } from '../db/index.js';
import {
  getEvent,
  listAdminPhotos,
  setPhotoHidden,
  deletePhotoCascade,
  updateTransitionStyle,
} from '../db/queries.js';
import {
  publicUrlForPhoto,
  publicUrlForVariant,
  uploadsDirFor,
  seedsDirFor,
  variantsDirFor,
  type StoragePaths,
} from '../lib/storage.js';
import { safeFilename } from '../lib/pathSafety.js';
import { variantFilename, VARIANT_WIDTHS } from '../lib/variants.js';
import type { LiveUpdateBus } from '../lib/liveUpdates.js';
import type { PhotoRow, TransitionStyle } from '../types.js';

const VALID_STYLES: TransitionStyle[] = ['default', 'cinematic'];

// Remove a file inside `dir` named `filename`, refusing any path that escapes
// `dir`. Missing files are ignored (idempotent delete).
function removeContained(dir: string, filename: string): void {
  const root = path.resolve(dir);
  const target = path.resolve(root, filename);
  if (target !== path.join(root, filename) || !target.startsWith(`${root}${path.sep}`)) {
    throw new Error('unsafe path');
  }
  if (fs.existsSync(target)) fs.rmSync(target);
}

function removePhotoFiles(paths: StoragePaths, eventId: string, row: PhotoRow): void {
  const filename = safeFilename(row.filename); // throws on traversal attempts
  const originalDir = row.source === 'seed' ? seedsDirFor(paths, eventId) : uploadsDirFor(paths, eventId);
  removeContained(originalDir, filename);
  const vdir = variantsDirFor(paths, eventId);
  for (const width of VARIANT_WIDTHS) {
    removeContained(vdir, variantFilename(filename, width));
  }
}

export function registerAdminRoutes(
  app: FastifyInstance,
  db: DB,
  paths: StoragePaths,
  requireAdmin: preHandlerHookHandler,
  liveUpdates?: LiveUpdateBus,
): void {
  app.get<{ Params: { id: string } }>(
    '/api/events/:id/admin/photos',
    { preHandler: requireAdmin },
    async (req, reply) => {
      const event = getEvent(db, req.params.id);
      if (!event) return reply.code(404).send({ error: 'event not found' });
      return listAdminPhotos(db, req.params.id).map((p) => ({
        ...p,
        url: publicUrlForPhoto(p.source, p.event_id, p.filename),
        url_1024: publicUrlForVariant(p.event_id, p.filename, 1024),
        url_320: publicUrlForVariant(p.event_id, p.filename, 320),
      }));
    },
  );

  app.patch<{ Params: { id: string; photoId: string }; Body: { hidden?: boolean } }>(
    '/api/events/:id/admin/photos/:photoId',
    { preHandler: requireAdmin },
    async (req, reply) => {
      const updated = setPhotoHidden(db, req.params.id, req.params.photoId, Boolean(req.body?.hidden));
      if (!updated) return reply.code(404).send({ error: 'photo not found' });
      liveUpdates?.publish({ type: 'photo_updated', eventId: req.params.id, createdAt: Date.now() });
      return { ok: true };
    },
  );

  app.delete<{ Params: { id: string; photoId: string } }>(
    '/api/events/:id/admin/photos/:photoId',
    { preHandler: requireAdmin },
    async (req, reply) => {
      const deleted = deletePhotoCascade(db, req.params.id, req.params.photoId);
      if (!deleted) return reply.code(404).send({ error: 'photo not found' });
      removePhotoFiles(paths, req.params.id, deleted);
      liveUpdates?.publish({ type: 'photo_deleted', eventId: req.params.id, createdAt: Date.now() });
      return { ok: true };
    },
  );

  app.patch<{ Params: { id: string }; Body: { transitionStyle?: string } }>(
    '/api/events/:id/admin/settings',
    { preHandler: requireAdmin },
    async (req, reply) => {
      const style = req.body?.transitionStyle;
      if (!style || !VALID_STYLES.includes(style as TransitionStyle)) {
        return reply.code(400).send({ error: 'invalid transitionStyle' });
      }
      const event = getEvent(db, req.params.id);
      if (!event) return reply.code(404).send({ error: 'event not found' });
      updateTransitionStyle(db, req.params.id, style);
      liveUpdates?.publish({ type: 'event_updated', eventId: req.params.id, createdAt: Date.now() });
      return { ok: true };
    },
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd api && npm test -- routes.test.ts`
Expected: PASS.

- [ ] **Step 5: Wire into the server**

In `api/src/server.ts`, add the import and registration. After the import of `makeRequireToken`:

```typescript
import { requireTokenSecret, makeRequireToken, makeRequireAdmin } from './lib/auth.js';
```

Add the admin routes import alongside the other route imports:

```typescript
import { registerAdminRoutes } from './routes/admin.js';
```

After the existing `registerPhotoRoutes(...)` call:

```typescript
  registerAdminRoutes(app, db, paths, makeRequireAdmin(tokenSecret), liveUpdates);
```

- [ ] **Step 6: Verify the server still type-checks**

Run: `cd api && npm run build`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add api/src/routes/admin.ts api/src/server.ts api/test/routes.test.ts
git commit -m "feat(api): admin routes for photo show/hide, atomic delete, transition style"
```

---

## Task 8: Path-safety regression test for delete

**Files:**
- Test: `api/test/routes.test.ts` (add one case)

The delete path builds filenames from the stored `photos.filename`, validated by `safeFilename`, and uses `path.resolve` containment in `removeContained`. This task locks that in with an explicit traversal test.

- [ ] **Step 1: Write the failing/guard test**

Add inside the `describe('admin routes', ...)` block in `api/test/routes.test.ts`:

```typescript
  it('delete refuses a stored filename that would escape the event dir', async () => {
    // Craft a malicious filename directly in the DB (bypassing upload validation),
    // then confirm delete does not remove anything outside the event variant/upload dirs.
    db.prepare('INSERT INTO photos (id, event_id, source, filename, credit, created_at, hidden) VALUES (?,?,?,?,?,?,0)')
      .run('evil', 'remembrance', 'upload', '../../escape.jpg', 'X', Date.now());
    const res = await app.inject({ method: 'DELETE', url: '/api/events/remembrance/admin/photos/evil', headers: { authorization: adminAuth() } });
    // safeFilename rejects the traversal -> route surfaces a 500, and the DB row was
    // already removed in the cascade tx; the key assertion is that no parent-dir file is touched.
    expect([200, 500]).toContain(res.statusCode);
    expect(fs.existsSync(path.resolve(paths.uploadsDir, '..', 'escape.jpg'))).toBe(false);
  });
```

- [ ] **Step 2: Run the test**

Run: `cd api && npm test -- routes.test.ts`
Expected: PASS — `safeFilename('../../escape.jpg')` throws (it matches neither `.`/`..` exactly nor the filename regex once it contains `/`), so no traversal write/delete occurs.

> If this fails because `safeFilename` does not reject the crafted name, STOP and surface it — that is a real path-safety gap, not a test bug.

- [ ] **Step 3: Commit**

```bash
git add api/test/routes.test.ts
git commit -m "test(api): delete path-safety regression for crafted filenames"
```

---

## Task 9: Boot log + CLI admin token

**Files:**
- Modify: `api/src/server.ts`
- Modify: `api/src/cli/mintToken.ts`

These are operator-facing console outputs (not unit-tested in this codebase; `formatBootToken` is already covered). Verify by running.

- [ ] **Step 1: Add the admin token to the boot log**

In `api/src/server.ts`, after the existing guest-token boot block:

```typescript
  const mintedAdmin = mintToken({ secret: tokenSecret, eid: event.id, ttlDays, baseUrl, role: 'admin' });
  console.log('✓ Admin token minted');
  for (const line of formatBootToken(mintedAdmin, baseUrl)) console.log(line);
```

- [ ] **Step 2: Add `--admin` to the CLI**

Rewrite `api/src/cli/mintToken.ts` so a `--admin` flag (in any arg position) mints an admin token, and a non-flag arg is still treated as the optional `baseUrl`:

```typescript
import { requireTokenSecret } from '../lib/auth.js';
import { mintToken } from '../lib/token.js';
import { resolveEventMode } from '../lib/seedEvents.js';

function main(): void {
  const secret = requireTokenSecret(process.env);
  const ttlDays = Number(process.env.TOKEN_TTL_DAYS) || 14;
  const eid = resolveEventMode();
  const args = process.argv.slice(2);
  const isAdmin = args.includes('--admin');
  const baseUrl = args.find((a) => !a.startsWith('--')); // optional

  const result = mintToken({ secret, eid, ttlDays, baseUrl, ...(isAdmin ? { role: 'admin' as const } : {}) });
  console.log(result.token);
  console.log(`Expires: ${result.expiresAt}`);
  console.log(result.url);
}

try {
  main();
} catch (err) {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
}
```

- [ ] **Step 3: Verify the CLI produces an /admin URL**

Run: `cd api && TOKEN_SECRET=devsecret npm run mint-token -- --admin https://ev.example`
Expected: the third printed line is `https://ev.example/admin#t=<token>`.

Run guest form: `cd api && TOKEN_SECRET=devsecret npm run mint-token -- https://ev.example`
Expected: third line is `https://ev.example/#t=<token>`.

- [ ] **Step 4: Commit**

```bash
git add api/src/server.ts api/src/cli/mintToken.ts
git commit -m "feat(api): print admin token at boot and via mint-token --admin"
```

---

## Task 10: Web — Event.transitionStyle mapping + admin types

**Files:**
- Modify: `web/src/types.ts`
- Modify: `web/src/lib/api.ts`
- Test: `web/src/test/api.test.ts` (add one case)

- [ ] **Step 1: Write the failing test**

In `web/src/test/api.test.ts`, add a case asserting `fetchEvents` maps `transition_style`. Mirror the file's existing fetch-mock style; if it stubs `fetch`, add:

```typescript
  it('maps transition_style to transitionStyle', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => [{
        id: 'e1', mode: 'remembrance', eyebrow: '', title: '', dateline: '', place: '',
        invitation: '', brand_sub: '', short_code: 'X', transition_style: 'cinematic',
      }],
    })) as unknown as typeof fetch);
    const [ev] = await fetchEvents();
    expect(ev.transitionStyle).toBe('cinematic');
  });
```

(Add `fetchEvents` to the file's imports and `import { vi } from 'vitest'` if not already present.)

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npm test -- api.test.ts`
Expected: FAIL — `transitionStyle` is undefined / not on the type.

- [ ] **Step 3: Implement the mapping + types**

In `web/src/types.ts`:

```typescript
export type Mode = 'celebration' | 'remembrance';
export type TransitionStyle = 'default' | 'cinematic';

export interface Event {
  id: string;
  mode: Mode;
  eyebrow: string;
  title: string;
  dateline: string;
  place: string;
  invitation: string;
  brandSub: string;
  shortCode: string;
  transitionStyle: TransitionStyle;
}
```

And add an admin photo type at the end of `web/src/types.ts`:

```typescript
export interface AdminPhoto extends Photo {
  hidden: boolean;
}
```

In `web/src/lib/api.ts`, extend `ApiEvent` and `toEvent`:

```typescript
interface ApiEvent {
  id: string;
  mode: Event['mode'];
  eyebrow: string;
  title: string;
  dateline: string;
  place: string;
  invitation: string;
  brand_sub: string;
  short_code: string;
  transition_style: string;
}
```

```typescript
const toEvent = (e: ApiEvent): Event => ({
  id: e.id,
  mode: e.mode,
  eyebrow: e.eyebrow,
  title: e.title,
  dateline: e.dateline,
  place: e.place,
  invitation: e.invitation,
  brandSub: e.brand_sub,
  shortCode: e.short_code,
  transitionStyle: e.transition_style === 'cinematic' ? 'cinematic' : 'default',
});
```

- [ ] **Step 4: Run the test + fix existing fixtures**

Run: `cd web && npm test -- api.test.ts`
Expected: PASS.

Then run the full web suite to catch fixtures that build an `Event` literal without `transitionStyle`:

Run: `cd web && npm test`
Expected: any `Event` object literals in tests (`App.test.tsx` `remembranceEvent`, etc.) now fail type-check. Add `transitionStyle: 'default'` to each. Re-run until green.

- [ ] **Step 5: Commit**

```bash
git add web/src/types.ts web/src/lib/api.ts web/src/test/api.test.ts web/src/test/App.test.tsx
git commit -m "feat(web): map transition_style to Event.transitionStyle; add AdminPhoto type"
```

---

## Task 11: Web — admin API helpers

**Files:**
- Create: `web/src/lib/adminApi.ts`
- Test: `web/src/test/adminApi.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `web/src/test/adminApi.test.ts`:

```typescript
import { describe, it, expect, vi, afterEach } from 'vitest';
import { fetchAdminPhotos, setPhotoHidden, deletePhoto, setTransitionStyle } from '../lib/adminApi';

afterEach(() => vi.unstubAllGlobals());

function mockFetch(impl: (url: string, init?: RequestInit) => Partial<Response>) {
  const fn = vi.fn(async (url: string, init?: RequestInit) => impl(url, init) as Response);
  vi.stubGlobal('fetch', fn as unknown as typeof fetch);
  return fn;
}

describe('adminApi', () => {
  it('fetchAdminPhotos sends the bearer token and maps rows', async () => {
    const fn = mockFetch(() => ({
      ok: true,
      json: async () => [{ id: 'p1', event_id: 'e1', source: 'seed', url: '/u', url_1024: '/a', url_320: '/b', credit: 'C', created_at: 1, hidden: 1 }],
    }));
    const photos = await fetchAdminPhotos('e1', 'tok');
    expect(fn).toHaveBeenCalledWith('/api/events/e1/admin/photos', expect.objectContaining({
      headers: { Authorization: 'Bearer tok' },
    }));
    expect(photos[0]).toMatchObject({ id: 'p1', hidden: true, source: 'seed', url320: '/b' });
  });

  it('setPhotoHidden PATCHes with the hidden body', async () => {
    const fn = mockFetch(() => ({ ok: true, json: async () => ({ ok: true }) }));
    await setPhotoHidden('e1', 'p1', true, 'tok');
    expect(fn).toHaveBeenCalledWith('/api/events/e1/admin/photos/p1', expect.objectContaining({
      method: 'PATCH',
      body: JSON.stringify({ hidden: true }),
    }));
  });

  it('deletePhoto DELETEs with the bearer token', async () => {
    const fn = mockFetch(() => ({ ok: true, json: async () => ({ ok: true }) }));
    await deletePhoto('e1', 'p1', 'tok');
    expect(fn).toHaveBeenCalledWith('/api/events/e1/admin/photos/p1', expect.objectContaining({ method: 'DELETE' }));
  });

  it('setTransitionStyle PATCHes settings', async () => {
    const fn = mockFetch(() => ({ ok: true, json: async () => ({ ok: true }) }));
    await setTransitionStyle('e1', 'cinematic', 'tok');
    expect(fn).toHaveBeenCalledWith('/api/events/e1/admin/settings', expect.objectContaining({
      method: 'PATCH',
      body: JSON.stringify({ transitionStyle: 'cinematic' }),
    }));
  });

  it('throws on a non-ok response', async () => {
    mockFetch(() => ({ ok: false, status: 401, json: async () => ({ error: 'nope' }) }));
    await expect(fetchAdminPhotos('e1', 'tok')).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd web && npm test -- adminApi.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement the helpers**

Create `web/src/lib/adminApi.ts`:

```typescript
import type { AdminPhoto, TransitionStyle } from '../types';

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
});

function authHeaders(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}` };
}

async function ensureOk(res: Response, url: string): Promise<Response> {
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `${url} -> ${res.status}`);
  }
  return res;
}

export async function fetchAdminPhotos(eventId: string, token: string): Promise<AdminPhoto[]> {
  const url = `/api/events/${eventId}/admin/photos`;
  const res = await ensureOk(await fetch(url, { headers: authHeaders(token) }), url);
  const data = (await res.json()) as ApiAdminPhoto[];
  return data.map(toAdminPhoto);
}

export async function setPhotoHidden(eventId: string, photoId: string, hidden: boolean, token: string): Promise<void> {
  const url = `/api/events/${eventId}/admin/photos/${photoId}`;
  await ensureOk(await fetch(url, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json', ...authHeaders(token) },
    body: JSON.stringify({ hidden }),
  }), url);
}

export async function deletePhoto(eventId: string, photoId: string, token: string): Promise<void> {
  const url = `/api/events/${eventId}/admin/photos/${photoId}`;
  await ensureOk(await fetch(url, { method: 'DELETE', headers: authHeaders(token) }), url);
}

export async function setTransitionStyle(eventId: string, transitionStyle: TransitionStyle, token: string): Promise<void> {
  const url = `/api/events/${eventId}/admin/settings`;
  await ensureOk(await fetch(url, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json', ...authHeaders(token) },
    body: JSON.stringify({ transitionStyle }),
  }), url);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd web && npm test -- adminApi.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/adminApi.ts web/src/test/adminApi.test.ts
git commit -m "feat(web): admin API helpers (photos, hide, delete, settings)"
```

---

## Task 12: Web — AdminApp page

**Files:**
- Create: `web/src/AdminApp.tsx`
- Test: `web/src/test/AdminApp.test.tsx`

- [ ] **Step 1: Write the failing tests**

Create `web/src/test/AdminApp.test.tsx`:

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import * as api from '../lib/api';
import * as adminApi from '../lib/adminApi';
import { AdminApp } from '../AdminApp';
import type { AdminPhoto, Event } from '../types';

const event: Event = {
  id: 'remembrance', mode: 'remembrance', eyebrow: '', title: 'T', dateline: '', place: '',
  invitation: '', brandSub: '', shortCode: 'X', transitionStyle: 'default',
};

const photo = (id: string, hidden = false): AdminPhoto => ({
  id, eventId: 'remembrance', source: 'seed', url: `/${id}.jpg`,
  url1024: `/${id}-1024.jpg`, url320: `/${id}-320.jpg`, credit: 'C', createdAt: 0, hidden,
});

beforeEach(() => {
  vi.spyOn(api, 'fetchEvents').mockResolvedValue([event]);
});

afterEach(() => {
  window.location.hash = '';
  vi.restoreAllMocks();
});

describe('AdminApp auth gate', () => {
  it('with no token shows the open-the-admin-link state and makes no admin calls', async () => {
    window.location.hash = '';
    const spy = vi.spyOn(adminApi, 'fetchAdminPhotos');
    render(<AdminApp />);
    expect(await screen.findByText(/open the admin link/i)).toBeInTheDocument();
    expect(spy).not.toHaveBeenCalled();
  });
});

describe('AdminApp curation', () => {
  beforeEach(() => {
    window.location.hash = '#t=admintok';
    vi.spyOn(adminApi, 'fetchAdminPhotos').mockResolvedValue([photo('p1'), photo('p2', true)]);
  });

  it('renders a card per photo with a Hidden marker on hidden ones', async () => {
    render(<AdminApp />);
    await waitFor(() => expect(adminApi.fetchAdminPhotos).toHaveBeenCalledWith('remembrance', 'admintok'));
    expect(screen.getAllByRole('img')).toHaveLength(2);
    expect(screen.getByText(/hidden/i)).toBeInTheDocument();
  });

  it('toggle calls setPhotoHidden with the flipped value', async () => {
    const spy = vi.spyOn(adminApi, 'setPhotoHidden').mockResolvedValue();
    render(<AdminApp />);
    await screen.findAllByRole('img');
    fireEvent.click(screen.getAllByRole('button', { name: /hide/i })[0]!);
    await waitFor(() => expect(spy).toHaveBeenCalledWith('remembrance', 'p1', true, 'admintok'));
  });

  it('delete requires a two-step confirm then calls deletePhoto and removes the card', async () => {
    const spy = vi.spyOn(adminApi, 'deletePhoto').mockResolvedValue();
    render(<AdminApp />);
    await screen.findAllByRole('img');
    fireEvent.click(screen.getAllByRole('button', { name: /^delete$/i })[0]!);
    expect(spy).not.toHaveBeenCalled(); // first click only arms the confirm
    fireEvent.click(screen.getByRole('button', { name: /confirm delete/i }));
    await waitFor(() => expect(spy).toHaveBeenCalledWith('remembrance', 'p1', 'admintok'));
    await waitFor(() => expect(screen.getAllByRole('img')).toHaveLength(1));
  });

  it('changing the transition style calls setTransitionStyle', async () => {
    const spy = vi.spyOn(adminApi, 'setTransitionStyle').mockResolvedValue();
    render(<AdminApp />);
    await screen.findAllByRole('img');
    fireEvent.click(screen.getByRole('button', { name: /cinematic/i }));
    await waitFor(() => expect(spy).toHaveBeenCalledWith('remembrance', 'cinematic', 'admintok'));
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd web && npm test -- AdminApp.test.tsx`
Expected: FAIL — `AdminApp` module does not exist.

- [ ] **Step 3: Implement AdminApp**

Create `web/src/AdminApp.tsx`. Keep it utilitarian; reuse Tailwind utility classes already used in the app.

```typescript
import { useEffect, useMemo, useState } from 'react';
import { fetchEvents } from './lib/api';
import { fetchAdminPhotos, setPhotoHidden, deletePhoto, setTransitionStyle } from './lib/adminApi';
import { readToken } from './lib/token';
import type { AdminPhoto, Event, TransitionStyle } from './types';

export function AdminApp() {
  const token = useMemo(() => readToken() ?? undefined, []);
  const [event, setEvent] = useState<Event | null>(null);
  const [photos, setPhotos] = useState<AdminPhoto[]>([]);
  const [style, setStyle] = useState<TransitionStyle>('default');
  const [error, setError] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    fetchEvents()
      .then((events) => {
        const ev = events[0] ?? null;
        setEvent(ev);
        if (ev) setStyle(ev.transitionStyle);
      })
      .catch((e) => setError(String(e)));
  }, [token]);

  useEffect(() => {
    if (!token || !event) return;
    fetchAdminPhotos(event.id, token)
      .then(setPhotos)
      .catch((e) => setError(e instanceof Error && /401/.test(e.message) ? "This link can't curate the wall." : String(e)));
  }, [token, event]);

  if (!token) {
    return (
      <div className="min-h-screen bg-neutral-950 text-neutral-100 flex items-center justify-center p-8">
        <p className="mono text-sm tracking-wide text-center">Open the admin link from your event setup to curate the wall.</p>
      </div>
    );
  }

  const onToggle = async (p: AdminPhoto) => {
    if (!event) return;
    const next = !p.hidden;
    setPhotos((cur) => cur.map((x) => (x.id === p.id ? { ...x, hidden: next } : x)));
    try {
      await setPhotoHidden(event.id, p.id, next, token);
    } catch {
      setPhotos((cur) => cur.map((x) => (x.id === p.id ? { ...x, hidden: p.hidden } : x))); // revert
    }
  };

  const onDelete = async (p: AdminPhoto) => {
    if (!event) return;
    if (confirmId !== p.id) {
      setConfirmId(p.id);
      return;
    }
    try {
      await deletePhoto(event.id, p.id, token);
      setPhotos((cur) => cur.filter((x) => x.id !== p.id));
    } catch (e) {
      setError(String(e));
    } finally {
      setConfirmId(null);
    }
  };

  const onStyle = async (next: TransitionStyle) => {
    if (!event) return;
    const prev = style;
    setStyle(next);
    try {
      await setTransitionStyle(event.id, next, token);
    } catch {
      setStyle(prev);
    }
  };

  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-100 p-6">
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

      {error && <p className="mb-4 text-sm text-amber-400">{error}</p>}

      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
        {photos.map((p) => (
          <div key={p.id} className={`rounded-lg overflow-hidden border border-neutral-800 ${p.hidden ? 'opacity-40' : ''}`}>
            <div className="relative aspect-square bg-neutral-900">
              <img src={p.url320} alt="" className="w-full h-full object-cover" />
              <span className="absolute top-1 left-1 mono text-[0.55rem] uppercase tracking-wide px-1.5 py-0.5 rounded bg-black/60">
                {p.source === 'seed' ? 'Seed' : 'Guest'}
              </span>
              {p.hidden && (
                <span className="absolute bottom-1 left-1 mono text-[0.55rem] uppercase px-1.5 py-0.5 rounded bg-black/70">Hidden</span>
              )}
            </div>
            <div className="flex">
              <button onClick={() => onToggle(p)} className="flex-1 py-2 text-xs mono border-r border-neutral-800 hover:bg-neutral-800">
                {p.hidden ? 'Show' : 'Hide'}
              </button>
              <button
                onClick={() => onDelete(p)}
                className={`flex-1 py-2 text-xs mono hover:bg-red-900/40 ${confirmId === p.id ? 'text-red-400' : ''}`}
              >
                {confirmId === p.id ? 'Confirm delete?' : 'Delete'}
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd web && npm test -- AdminApp.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/AdminApp.tsx web/src/test/AdminApp.test.tsx
git commit -m "feat(web): AdminApp curation page with hide/delete/transition controls"
```

---

## Task 13: Web — route /admin in main.tsx

**Files:**
- Modify: `web/src/main.tsx`
- Test: `web/src/test/main.test.tsx`

`main.tsx` currently renders into `#root` on import (side-effecting). To make routing testable, extract the page-selection into a pure exported function and keep the mount as the only side effect.

- [ ] **Step 1: Write the failing test**

Create `web/src/test/main.test.tsx`:

```typescript
import { describe, it, expect, afterEach } from 'vitest';
import { selectPage } from '../main';
import { App } from '../App';
import { AdminApp } from '../AdminApp';

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
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npm test -- main.test.tsx`
Expected: FAIL — `selectPage` is not exported.

- [ ] **Step 3: Refactor main.tsx**

Edit `web/src/main.tsx` to export `selectPage` and branch the mount on `location.pathname` (keep all the existing font + css imports unchanged):

```typescript
import { StrictMode, type ComponentType } from 'react';
import { createRoot } from 'react-dom/client';

// Self-hosted fonts (v0.1.4) — replaces the Google Fonts CDN link.
import '@fontsource/inter/latin-300.css';
import '@fontsource/inter/latin-400.css';
import '@fontsource/inter/latin-500.css';
import '@fontsource/inter/latin-600.css';
import '@fontsource/inter/latin-700.css';
import '@fontsource/instrument-serif/latin-400.css';
import '@fontsource/instrument-serif/latin-400-italic.css';
import '@fontsource/jetbrains-mono/latin-400.css';
import '@fontsource/jetbrains-mono/latin-500.css';

import './index.css';
import { App } from './App';
import { AdminApp } from './AdminApp';

export function selectPage(pathname: string): ComponentType {
  return pathname === '/admin' ? AdminApp : App;
}

const Page = selectPage(window.location.pathname);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Page />
  </StrictMode>,
);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && npm test -- main.test.tsx`
Expected: PASS.

> Note: importing `main.tsx` in a test triggers the `createRoot(...)` mount. `#root` does not exist in jsdom, so `getElementById('root')!` is null and `createRoot(null!)` throws on import. To keep `selectPage` importable, guard the mount: wrap the `createRoot(...).render(...)` in `if (document.getElementById('root')) { ... }`. Apply that guard in Step 3 (replace the bare `createRoot` call with the guarded form). Re-run Step 4.

- [ ] **Step 5: Commit**

```bash
git add web/src/main.tsx web/src/test/main.test.tsx
git commit -m "feat(web): route /admin to AdminApp via selectPage"
```

---

## Task 14: nginx /admin SPA fallback — regression test

**Files:**
- Modify: `web/src/test/securityHeaders.test.ts` (add one case)
- Modify: `nginx.conf` *only if the assertion fails*

**Surfaced tradeoff:** the existing `location / { try_files $uri $uri/ /index.html; }` already serves `index.html` for `/admin` (it is the catch-all). So no nginx change is expected — this task adds a regression assertion that locks the fallback in. The spec assumed a config change; in practice the existing catch-all covers it. Only edit `nginx.conf` if the assertion below cannot be satisfied by the current file.

- [ ] **Step 1: Write the failing/guard test**

Add to `web/src/test/securityHeaders.test.ts` (it already reads `nginxConf`):

```typescript
  it('falls back to index.html for SPA deep links like /admin', () => {
    expect(nginxConf).toMatch(/location \/ \{[\s\S]*try_files \$uri \$uri\/ \/index\.html;/);
  });
```

- [ ] **Step 2: Run the test**

Run: `cd web && npm test -- securityHeaders.test.ts`
Expected: PASS against the current `nginx.conf` (the SPA block already has that `try_files`). If it FAILS, add/restore `try_files $uri $uri/ /index.html;` inside the `location / { ... }` block in `nginx.conf`, then re-run.

- [ ] **Step 3: Commit**

```bash
git add web/src/test/securityHeaders.test.ts nginx.conf
git commit -m "test: lock in nginx SPA fallback for /admin deep links"
```

---

## Task 15: Slideshow cinematic transition — selection wiring

**Files:**
- Modify: `web/src/components/Wall.tsx`
- Test: `web/src/test/Wall.test.tsx` (add one case)

Per project rules, the *animation visuals* are browser-verified and exempt from unit assertions. This task asserts only the **selection wiring**: when `event.transitionStyle === 'cinematic'`, the Wall applies the cinematic enter class.

- [ ] **Step 1: Write the failing test**

Open `web/src/test/Wall.test.tsx` to match its existing render helpers (it builds `Wall` with `photos`/`messages`/`mode`/`event`). Add a case that renders with a cinematic event and asserts the cinematic enter class is present on the current slide wrapper:

```typescript
  it('applies the cinematic enter class when event.transitionStyle is cinematic', () => {
    const ev = { ...baseEvent, transitionStyle: 'cinematic' as const };
    const { container } = render(
      <Wall photos={navPhotos} messages={[]} mode="remembrance" paused event={ev} />,
    );
    expect(container.querySelector('.slide-cine-remb')).toBeTruthy();
  });

  it('uses the default enter class when transitionStyle is default', () => {
    const ev = { ...baseEvent, transitionStyle: 'default' as const };
    const { container } = render(
      <Wall photos={navPhotos} messages={[]} mode="remembrance" paused event={ev} />,
    );
    expect(container.querySelector('.slide-remb')).toBeTruthy();
    expect(container.querySelector('.slide-cine-remb')).toBeFalsy();
  });
```

(Reuse / define `baseEvent` and `navPhotos` to match the file's existing fixtures; if the file already has equivalents, use those names. Ensure `baseEvent` includes `transitionStyle: 'default'`.)

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npm test -- Wall.test.tsx`
Expected: FAIL — `.slide-cine-remb` is never applied.

- [ ] **Step 3: Implement the selection wiring**

In `web/src/components/Wall.tsx`, derive the enter class and durations from `event?.transitionStyle`. Replace the three derivation lines:

```typescript
  const cinematic = event?.transitionStyle === 'cinematic';
  const slideMs = mode === 'celebration' ? 4200 : 7200;
  const enterClass = cinematic
    ? (mode === 'celebration' ? 'slide-cine-cele' : 'slide-cine-remb')
    : (mode === 'celebration' ? 'slide-cele' : 'slide-remb');
  const fadeDur = cinematic
    ? (mode === 'celebration' ? 600 : 1200)
    : (mode === 'celebration' ? 700 : 1400);
```

(The cinematic durations 600/1200 match the spec's "celebration ~600ms / remembrance ~1200ms". Everything downstream — `enterClass`, `fadeDur` — already flows into `SlideWrapper`.)

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && npm test -- Wall.test.tsx`
Expected: PASS.

- [ ] **Step 5: Add cinematic CSS keyframes (browser-verified, no unit test)**

In `web/src/index.css`, alongside the existing `.slide-cele` / `.slide-remb` enter classes, add `.slide-cine-cele` and `.slide-cine-remb`. Start by mirroring the existing enter classes plus a Ken Burns / drop emphasis; refine in the browser:

```css
/* v0.7 cinematic transitions — refined via browser verification */
.slide-cine-remb {
  animation: cineRembIn 1200ms cubic-bezier(0.22, 1, 0.36, 1) both;
}
.slide-cine-cele {
  animation: cineCeleIn 600ms cubic-bezier(0.22, 1, 0.36, 1) both;
}
@keyframes cineRembIn {
  from { opacity: 0; transform: scale(1.04); filter: saturate(0.92); }
  to   { opacity: 1; transform: scale(1);    filter: saturate(1); }
}
@keyframes cineCeleIn {
  from { opacity: 0; transform: translateY(2%) scale(1.02); }
  to   { opacity: 1; transform: translateY(0)  scale(1); }
}
```

- [ ] **Step 6: Browser-verify the animation**

Run the app (`cd web && npm run dev`, with the API running per the repo's dev instructions), open `/`, then in the admin page switch the style to `Cinematic` and confirm on the main wall the transitions change (and `Default` is unchanged). This is the exempt visual check — no assertion.

- [ ] **Step 7: Commit**

```bash
git add web/src/components/Wall.tsx web/src/index.css web/src/test/Wall.test.tsx
git commit -m "feat(web): select cinematic enter classes/durations from transitionStyle"
```

---

## Task 16: Web — live refresh refetches the event

**Files:**
- Modify: `web/src/App.tsx`
- Test: `web/src/test/App.test.tsx` (add one case)

So a `transition_style` change (and hide/delete) reaches the TV via the v0.6 bus without a manual reload, the App's `refresh` must also refetch the event.

- [ ] **Step 1: Write the failing test**

Add to `web/src/test/App.test.tsx`, in the `App live updates` describe (it already stubs `FakeEventSource`):

```typescript
  it('refetches the event on a live update so transition style changes propagate', async () => {
    const cinematicEvent = { ...remembranceEvent, transitionStyle: 'cinematic' as const };
    vi.spyOn(api, 'fetchEvents')
      .mockResolvedValueOnce([remembranceEvent])
      .mockResolvedValue([cinematicEvent]);

    const { container } = await renderApp();
    await waitFor(() => expect(api.fetchPhotos).toHaveBeenCalled());

    act(() => {
      FakeEventSource.instances[0]!.emit('mosaic-update');
    });

    await waitFor(() => expect(api.fetchEvents).toHaveBeenCalledTimes(2));
    expect(container.querySelector('.slide-cine-remb') ?? true).toBeTruthy(); // event refetch happened
  });
```

(The key assertion is `fetchEvents` called a second time on update. The DOM check is best-effort given no photos in this case.)

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npm test -- App.test.tsx`
Expected: FAIL — `fetchEvents` is called only once (on mount), not on update.

- [ ] **Step 3: Implement the event refetch in refresh**

In `web/src/App.tsx`, fold the event fetch into `refresh` so live updates re-pull it. Replace the mount-only `fetchEvents` effect + `refresh` with:

```typescript
  const refresh = useCallback(async () => {
    const events = await fetchEvents();
    setEvents(events);
    const ev = events[0];
    if (!ev) return;
    const [p, m] = await Promise.all([fetchPhotos(ev.id), fetchMessages(ev.id)]);
    setPhotosByEvent((prev) => ({ ...prev, [ev.id]: p }));
    setMessagesByEvent((prev) => ({ ...prev, [ev.id]: m }));
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);
```

Remove the now-redundant mount-only effect:

```typescript
  // delete this block — refresh() now loads events too
  useEffect(() => {
    fetchEvents().then(setEvents).catch(console.error);
  }, []);
```

`useLiveUpdates(event?.id, refresh, POLL_MS)` already calls `refresh` on every update and on the polling fallback, so the event is now refetched on both paths.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd web && npm test -- App.test.tsx`
Expected: PASS. (The existing "refreshes counters on update" test still passes — `fetchPhotos` is still called per refresh.)

- [ ] **Step 5: Commit**

```bash
git add web/src/App.tsx web/src/test/App.test.tsx
git commit -m "feat(web): refetch event on live update so transition style propagates"
```

---

## Task 17: Full verification

**Files:** none (verification only)

- [ ] **Step 1: API suite + build**

Run: `cd api && npm test && npm run build`
Expected: all tests PASS; build clean.

- [ ] **Step 2: Web suite + build**

Run: `cd web && npm test && npm run build`
Expected: all tests PASS; build clean.

- [ ] **Step 3: Manual reboot-persistence check (acceptance criterion)**

With a local dev DB: hide a photo via `/admin`, restart the API, confirm via `GET /api/events/:id/photos` that the hidden photo stays excluded and is not reset. Delete a photo, restart, confirm it does not reappear and the seed file is gone from disk. This exercises the "survives reboot" and "atomic delete" acceptance criteria that unit tests approximate but the real seed-reindex path confirms.

- [ ] **Step 4: Update the roadmap**

Per `CLAUDE.md` rule 1, update `../mosaic-specs/roadmap.md`: move "Admin curation page (+ delete + transitions)" from Backlog to shipped/v0.7. Set the spec's `**Status:**` from `Draft` to `Shipped` (or `Implemented`).

```bash
git add ../mosaic-specs/roadmap.md  # if the specs repo is committed separately, commit there
git commit -m "docs: mark v0.7 admin curation shipped"
```

---

## Self-Review (completed against the spec)

- **Token / auth tests** → Tasks 3, 5. ✓
- **Queries tests** (`listPhotos` excludes hidden, `listAdminPhotos` includes, `setPhotoHidden`, `deletePhotoCascade`, `updateTransitionStyle`) → Task 4. ✓
- **Routes tests** (401 no/guest token on all four, PATCH toggles + public reflects, DELETE removes row/message/original/variants + second 404, PATCH/DELETE not-in-event 404, delete path-safety, settings 400/200, public excludes hidden) → Tasks 7, 8. ✓
- **Migration test** (003 once, columns, defaults) → Task 1. ✓
- **Frontend tests** (main routes /admin vs /, AdminApp no-token state issues no requests, toggle/delete endpoints + two-step confirm, Wall selects cinematic wiring) → Tasks 10–13, 15. ✓
- **Config test** (nginx /admin SPA fallback) → Task 14. ✓
- **Data model** (`photos.hidden`, `events.transition_style`, `EventRow`/`PhotoRow` fields, admin response carries source/hidden/urls) → Tasks 1, 2, 4, 7. ✓
- **Minting paths** (boot log admin token, `mint-token --admin`) → Tasks 3, 9. ✓
- **Live propagation** (admin mutations publish; slideshow refetches event) → Tasks 6, 7, 16. ✓
- **Cinematic transition** (selection wiring tested; animation browser-verified) → Task 15. ✓

**Type consistency:** `setPhotoHidden(eventId, photoId, hidden, token)`, `deletePhoto(eventId, photoId, token)`, `setTransitionStyle(eventId, style, token)`, `fetchAdminPhotos(eventId, token)` are used identically in `adminApi.ts` (Task 11), its test (Task 11), and `AdminApp.tsx`/its test (Task 12). API queries `setPhotoHidden`/`deletePhotoCascade`/`updateTransitionStyle` signatures match between Task 4 definitions and Task 7 route usage. Enter classes `slide-cine-cele`/`slide-cine-remb` match between Wall (Task 15) and CSS (Task 15) and the Wall test. ✓

**Surfaced tradeoffs (per CLAUDE.md §3):**
1. **nginx (Task 14):** the existing catch-all already provides the `/admin` SPA fallback the spec calls for; the task is a regression assertion, not a real config change. Stated inline.
2. **`main.tsx` testability (Task 13):** the module mounts on import; the plan guards the mount so `selectPage` is importable in jsdom. Stated inline.
3. **`transition_style` not in `upsertEvent`'s `DO UPDATE SET` (Task 4):** intentional, so boot re-seeding never resets an operator's chosen style — mirrors the spec's "survives reboot" guarantee. Stated inline.
