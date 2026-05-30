# Message–Photo Pairing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A guest's message only ever appears with the photo they uploaded it with; text-only messages render on a mode-specific note card.

**Architecture:** Link a message to its photo via a nullable `messages.photo_id` FK. The photo upload route writes the photo and its linked message in one transaction (text-only messages still use the messages route). `buildSequence` partitions content into paired / plain / standalone pools so pairing is deterministic. Standalone messages render on a physical note card (upright for remembrance, tilted for celebration).

**Tech Stack:** Fastify + better-sqlite3 (API, TypeScript, ESM), Vite + React + TypeScript (web), Vitest, `sharp` (already used in the upload pipeline). Spec: [`../../../../mosaic-specs/v0.2.1-message-photo-pairing-spec.md`](../../../../mosaic-specs/v0.2.1-message-photo-pairing-spec.md).

---

## File Structure

**API (`api/`):**
- `src/db/migrate.ts` — gains a `schema_migrations` table so each `.sql` file applies exactly once (modify)
- `migrations/002_message_photo_link.sql` — new migration adding `messages.photo_id` (create)
- `src/types.ts` — `MessageRow.photo_id` (modify)
- `src/db/queries.ts` — `InsertMessageInput.photo_id`, `insertMessage` writes it (modify)
- `src/routes/photos.ts` — accept `message` field, atomic photo+message insert, return `message` (modify)
- `test/migrate.test.ts` — new (create)
- `test/queries.test.ts`, `test/routes.test.ts`, `test/seedIndex.test.ts` — load all migrations for the test schema; new assertions (modify)

**Web (`web/`):**
- `src/types.ts` — `Message.photoId`; `message` slide drops `photo` (modify)
- `src/lib/api.ts` — `ApiMessage.photo_id`, `toMessage`, `uploadPhoto` signature + return (modify)
- `src/App.tsx` — `handleSubmit` single-call path for photo submissions (modify)
- `src/lib/buildSequence.ts` — partition + typed routing rewrite (modify)
- `src/components/slides/MessageSlide.tsx` — mode-specific note card (modify)
- `src/test/buildSequence.test.ts` — new pairing cases + helper (modify)
- `src/test/Wall.test.tsx` — drop `photo` from the message-slide fixture, add `photoId` to fixture (modify)

**Commit branch:** all work happens on a feature branch (e.g. `fix/message-photo-pairing`), not `main`. Create it before Task 1 if not already in an isolated worktree.

**Run commands** (from repo root `/home/aluxh/code/aluxh/mosaic`):
- API tests: `npm run test:api -- --run [path]`
- Web tests: `npm run test:web -- --run [path]`

---

## Task 1: Migration runner applies each file once

The runner currently re-execs every `.sql` file on every boot. The next task adds a non-idempotent `ALTER TABLE`, which would crash on the second boot. Add a `schema_migrations` table so each file runs exactly once.

**Files:**
- Modify: `api/src/db/migrate.ts`
- Test: `api/test/migrate.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `api/test/migrate.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { openDatabase } from '../src/db/index.js';
import { migrate } from '../src/db/migrate.js';

describe('migrate', () => {
  it('applies migrations and records each in schema_migrations', () => {
    const db = openDatabase(':memory:');
    migrate(db);
    const applied = (
      db.prepare('SELECT filename FROM schema_migrations').all() as { filename: string }[]
    ).map((r) => r.filename);
    expect(applied).toContain('001_init.sql');
    db.close();
  });

  it('is idempotent across repeated runs', () => {
    const db = openDatabase(':memory:');
    migrate(db);
    const count = () =>
      (db.prepare('SELECT count(*) AS n FROM schema_migrations').get() as { n: number }).n;
    const first = count();
    expect(() => migrate(db)).not.toThrow();
    expect(count()).toBe(first);
    db.close();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:api -- --run test/migrate.test.ts`
Expected: FAIL — `no such table: schema_migrations` (the current `migrate` does not create it).

- [ ] **Step 3: Rewrite `migrate` to apply each file once**

Replace the `migrate` function in `api/src/db/migrate.ts` (keep the imports and `applySchemaFromString` as-is):

```ts
export function migrate(db: DB): void {
  db.exec(
    `CREATE TABLE IF NOT EXISTS schema_migrations (
       filename   TEXT PRIMARY KEY,
       applied_at INTEGER NOT NULL
     )`,
  );

  const applied = new Set(
    (db.prepare('SELECT filename FROM schema_migrations').all() as { filename: string }[]).map(
      (r) => r.filename,
    ),
  );

  const files = fs
    .readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  const record = db.prepare(
    'INSERT INTO schema_migrations (filename, applied_at) VALUES (?, ?)',
  );

  for (const f of files) {
    if (applied.has(f)) continue;
    const sql = fs.readFileSync(path.join(migrationsDir, f), 'utf8');
    const run = db.transaction(() => {
      db.exec(sql);
      record.run(f, Date.now());
    });
    run();
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:api -- --run test/migrate.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Confirm the existing suite still passes**

Run: `npm run test:api -- --run`
Expected: PASS — existing tests use `applySchemaFromString` (unchanged) and are unaffected.

- [ ] **Step 6: Commit**

```bash
git add api/src/db/migrate.ts api/test/migrate.test.ts
git commit -m "$(printf 'feat(api): apply each migration once via schema_migrations\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

## Task 2: Add the `photo_id` migration and load all migrations in tests

**Files:**
- Create: `api/migrations/002_message_photo_link.sql`
- Modify: `api/test/migrate.test.ts`, `api/test/queries.test.ts`, `api/test/routes.test.ts`, `api/test/seedIndex.test.ts`

- [ ] **Step 1: Write the new migration**

Create `api/migrations/002_message_photo_link.sql`:

```sql
ALTER TABLE messages ADD COLUMN photo_id TEXT REFERENCES photos(id);
CREATE INDEX IF NOT EXISTS idx_messages_photo ON messages(photo_id);
```

(SQLite permits `ADD COLUMN ... REFERENCES` because the column defaults to `NULL`.)

- [ ] **Step 2: Point the test schema at all migrations, not just 001**

In **each** of `api/test/queries.test.ts`, `api/test/routes.test.ts`, and `api/test/seedIndex.test.ts`, replace the single-file `SCHEMA` constant:

```ts
const SCHEMA = fs.readFileSync(
  path.resolve(__dirname, '..', 'migrations', '001_init.sql'),
  'utf8',
);
```

with a concatenation of every migration in order:

```ts
const migrationsDir = path.resolve(__dirname, '..', 'migrations');
const SCHEMA = fs
  .readdirSync(migrationsDir)
  .filter((f) => f.endsWith('.sql'))
  .sort()
  .map((f) => fs.readFileSync(path.join(migrationsDir, f), 'utf8'))
  .join('\n');
```

(`seedIndex.test.ts` uses a different variable name for the resolved path; replace its `001_init.sql` read with the same `readdirSync(...).sort().map(...).join` block, keeping its existing `SCHEMA`/variable name.)

- [ ] **Step 3: Extend the migrate test to assert the column exists**

Add this test inside the `describe('migrate', ...)` block in `api/test/migrate.test.ts`:

```ts
  it('adds messages.photo_id', () => {
    const db = openDatabase(':memory:');
    migrate(db);
    const cols = (
      db.prepare('PRAGMA table_info(messages)').all() as { name: string }[]
    ).map((c) => c.name);
    expect(cols).toContain('photo_id');
    db.close();
  });
```

- [ ] **Step 4: Run the API suite**

Run: `npm run test:api -- --run`
Expected: PASS. The new migrate test confirms `photo_id` exists; the three updated test files now build their schema from both migrations. The `ALTER` runs cleanly on a fresh in-memory DB after `001`'s `CREATE`.

- [ ] **Step 5: Commit**

```bash
git add api/migrations/002_message_photo_link.sql api/test/migrate.test.ts api/test/queries.test.ts api/test/routes.test.ts api/test/seedIndex.test.ts
git commit -m "$(printf 'feat(api): add nullable messages.photo_id migration\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

## Task 3: Persist `photo_id` in the messages query layer

**Files:**
- Modify: `api/src/types.ts`, `api/src/db/queries.ts`
- Test: `api/test/queries.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to the `describe('messages queries', ...)` block in `api/test/queries.test.ts`. The file already imports `insertPhoto`, `insertMessage`, `listMessages` and seeds a `remembrance` event in `beforeEach`. The DB opens with `foreign_keys = ON`, so the linked test inserts its photo row first:

```ts
  it('insertMessage persists a photo_id link', () => {
    insertPhoto(db, {
      id: 'p1',
      event_id: 'remembrance',
      source: 'upload',
      filename: 'a.jpg',
      credit: 'Maya',
      created_at: 1,
    });
    insertMessage(db, {
      id: 'msg-linked',
      event_id: 'remembrance',
      name: 'Maya',
      text: 'With my photo',
      created_at: 10,
      photo_id: 'p1',
    });
    const row = listMessages(db, 'remembrance').find((r) => r.id === 'msg-linked');
    expect(row?.photo_id).toBe('p1');
  });

  it('insertMessage defaults photo_id to null when omitted', () => {
    insertMessage(db, {
      id: 'msg-standalone',
      event_id: 'remembrance',
      name: 'Eleanor',
      text: 'No photo',
      created_at: 11,
    });
    const row = listMessages(db, 'remembrance').find((r) => r.id === 'msg-standalone');
    expect(row?.photo_id).toBeNull();
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test:api -- --run test/queries.test.ts`
Expected: FAIL — `photo_id` is not written (column not in the `INSERT`); `row.photo_id` is `undefined`, and the linked test errors on the type since `InsertMessageInput` has no `photo_id`.

- [ ] **Step 3: Add `photo_id` to the row type**

In `api/src/types.ts`, add the field to `MessageRow`:

```ts
export interface MessageRow {
  id: string;
  event_id: string;
  name: string;
  text: string;
  created_at: number;
  photo_id: string | null;
}
```

- [ ] **Step 4: Write `photo_id` in `insertMessage`**

In `api/src/db/queries.ts`, replace the `InsertMessageInput` interface and `insertMessage` function:

```ts
export interface InsertMessageInput {
  id: string;
  event_id: string;
  name: string;
  text: string;
  created_at: number;
  photo_id?: string | null;
}

export function insertMessage(db: DB, m: InsertMessageInput): MessageRow {
  const row = { ...m, photo_id: m.photo_id ?? null };
  db.prepare(
    `INSERT INTO messages (id, event_id, name, text, created_at, photo_id)
     VALUES (@id, @event_id, @name, @text, @created_at, @photo_id)`,
  ).run(row);
  return row as MessageRow;
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm run test:api -- --run test/queries.test.ts`
Expected: PASS, including the two new tests.

- [ ] **Step 6: Commit**

```bash
git add api/src/types.ts api/src/db/queries.ts api/test/queries.test.ts
git commit -m "$(printf 'feat(api): persist messages.photo_id in query layer\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

## Task 4: Atomic photo + message upload

The photo route gains an optional `message` field. When present, it writes the photo and a linked message in one transaction and returns the message in the response.

**Files:**
- Modify: `api/src/routes/photos.ts`
- Test: `api/test/routes.test.ts`

- [ ] **Step 1: Write the failing tests**

The `describe('POST /api/events/:id/photos', ...)` block in `api/test/routes.test.ts` already defines a raw-multipart `uploadBuffer(buf, filename, contentType)` helper (file part only). Add a sibling helper that also appends form fields, then the three tests, inside the same block:

```ts
  function uploadWithFields(
    buf: Buffer,
    filename: string,
    contentType: string,
    fields: Record<string, string>,
  ): ReturnType<typeof app.inject> {
    const boundary = '----test-boundary';
    const parts: Buffer[] = [
      Buffer.from(`--${boundary}\r\n`),
      Buffer.from(
        `Content-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${contentType}\r\n\r\n`,
      ),
      buf,
      Buffer.from('\r\n'),
    ];
    for (const [name, value] of Object.entries(fields)) {
      parts.push(
        Buffer.from(`--${boundary}\r\n`),
        Buffer.from(`Content-Disposition: form-data; name="${name}"\r\n\r\n`),
        Buffer.from(value),
        Buffer.from('\r\n'),
      );
    }
    parts.push(Buffer.from(`--${boundary}--\r\n`));
    return app.inject({
      method: 'POST',
      url: '/api/events/remembrance/photos',
      headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
      payload: Buffer.concat(parts),
    });
  }

  it('links a message when the message field is present', async () => {
    const res = await uploadWithFields(minimalPng, 'p.png', 'image/png', {
      credit: 'Maya',
      message: 'Wishing you joy',
    });
    expect(res.statusCode).toBe(201);
    const body = res.json() as {
      id: string;
      message: { id: string; photo_id: string; text: string } | null;
    };
    expect(body.message).not.toBeNull();
    expect(body.message?.photo_id).toBe(body.id);
    expect(body.message?.text).toBe('Wishing you joy');

    const list = await app.inject({ method: 'GET', url: '/api/events/remembrance/messages' });
    const msgs = list.json() as { photo_id: string | null }[];
    expect(msgs.some((m) => m.photo_id === body.id)).toBe(true);
  });

  it('returns message: null when no message field is sent', async () => {
    const res = await uploadWithFields(minimalPng, 'p.png', 'image/png', { credit: 'Maya' });
    expect(res.statusCode).toBe(201);
    expect((res.json() as { message: unknown }).message).toBeNull();
  });

  it('rejects an over-long message without writing the photo (atomic)', async () => {
    const res = await uploadWithFields(minimalPng, 'p.png', 'image/png', {
      credit: 'Maya',
      message: 'x'.repeat(241),
    });
    expect(res.statusCode).toBe(400);
    const photos = await app.inject({ method: 'GET', url: '/api/events/remembrance/photos' });
    expect((photos.json() as unknown[]).length).toBe(0);
    const msgs = await app.inject({ method: 'GET', url: '/api/events/remembrance/messages' });
    expect((msgs.json() as unknown[]).length).toBe(0);
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test:api -- --run test/routes.test.ts`
Expected: FAIL — response has no `message` field (`undefined`, not `null`); no linked row is written; the over-long case is not rejected.

- [ ] **Step 3: Implement the route**

Replace the body of the `app.post` handler in `api/src/routes/photos.ts`. Update the import line and the handler:

```ts
import { getEvent, insertPhoto, insertMessage } from '../db/queries.js';
```

```ts
  app.post<{ Params: { id: string } }>(
    '/api/events/:id/photos',
    async (req, reply) => {
      const event = getEvent(db, req.params.id);
      if (!event) return reply.code(404).send({ error: 'event not found' });

      const parts = req.parts();
      let fileBuf: Buffer | null = null;
      let credit = '';
      let message = '';

      for await (const part of parts) {
        if (part.type === 'file' && part.fieldname === 'file') {
          try {
            fileBuf = await part.toBuffer();
          } catch {
            return reply.code(413).send({ error: 'file too large (max 10MB)' });
          }
        } else if (part.type === 'field' && part.fieldname === 'credit') {
          credit = String(part.value ?? '').trim();
        } else if (part.type === 'field' && part.fieldname === 'message') {
          message = String(part.value ?? '').trim();
        }
      }

      if (!fileBuf) return reply.code(400).send({ error: 'file is required' });
      if (message.length > 240) {
        return reply.code(400).send({ error: 'text too long (max 240)' });
      }

      const result = await ingestImage(fileBuf, MAX_FILE_BYTES);
      if (!result.ok) {
        return reply.code(result.code).send({ error: result.error });
      }

      const id = newId();
      const filename = `${id}${result.ext}`;
      const dir = uploadsDirFor(paths, req.params.id);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, filename), result.buf);

      const createdAt = Date.now();
      const writePair = db.transaction(() => {
        const photo = insertPhoto(db, {
          id,
          event_id: req.params.id,
          source: 'upload',
          filename,
          credit: credit || 'Guest',
          created_at: createdAt,
        });
        const msg = message
          ? insertMessage(db, {
              id: newId(),
              event_id: req.params.id,
              name: credit || 'A friend',
              text: message,
              created_at: createdAt,
              photo_id: id,
            })
          : null;
        return { photo, msg };
      });
      const { photo, msg } = writePair();

      return reply.code(201).send({
        ...photo,
        url: publicUrlForPhoto('upload', req.params.id, filename),
        message: msg,
      });
    },
  );
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test:api -- --run test/routes.test.ts`
Expected: PASS, including the three new tests and the existing upload/EXIF tests (the response still carries `source`, `filename`, `url` at top level).

- [ ] **Step 5: Run the full API suite**

Run: `npm run test:api -- --run`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add api/src/routes/photos.ts api/test/routes.test.ts
git commit -m "$(printf 'feat(api): write photo + linked message atomically on upload\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

## Task 5: Carry `photoId` through the web API client

**Files:**
- Modify: `web/src/types.ts` (the `Message` interface only), `web/src/lib/api.ts`

- [ ] **Step 1: Add `photoId` to the `Message` type**

In `web/src/types.ts`, add the field to `Message`:

```ts
export interface Message {
  id: string;
  eventId: string;
  name: string;
  text: string;
  createdAt: number;
  photoId: string | null;
}
```

- [ ] **Step 2: Map it in the API client**

In `web/src/lib/api.ts`, add `photo_id` to `ApiMessage` and map it in `toMessage`:

```ts
interface ApiMessage {
  id: string;
  event_id: string;
  name: string;
  text: string;
  created_at: number;
  photo_id: string | null;
}
```

```ts
const toMessage = (m: ApiMessage): Message => ({
  id: m.id,
  eventId: m.event_id,
  name: m.name,
  text: m.text,
  createdAt: m.created_at,
  photoId: m.photo_id,
});
```

- [ ] **Step 3: Typecheck the web package**

Run: `npm run test:web -- --run src/test/buildSequence.test.ts`
Expected: PASS — existing `buildSequence` tests construct messages via `makeMessages`, which will be updated in Task 7; for now the `Message` interface change is additive at the type level and the existing tests' message objects will fail typecheck only if run under `tsc`. Vitest (esbuild) still runs them. (Full typecheck is reconciled in Task 7.)

- [ ] **Step 4: Commit**

```bash
git add web/src/types.ts web/src/lib/api.ts
git commit -m "$(printf 'feat(web): carry message.photoId through the API client\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

## Task 6: Single-call submission for photo contributions

`uploadPhoto` accepts the message and returns both the photo and the linked message; `handleSubmit` makes one call when a file is present.

**Files:**
- Modify: `web/src/lib/api.ts`, `web/src/App.tsx`

- [ ] **Step 1: Update `uploadPhoto`**

In `web/src/lib/api.ts`, replace `uploadPhoto`:

```ts
export async function uploadPhoto(
  eventId: string,
  file: File,
  name?: string,
  message?: string,
): Promise<{ photo: Photo; message: Message | null }> {
  const fd = new FormData();
  fd.append('file', file);
  if (name) fd.append('credit', name);
  if (message) fd.append('message', message);
  const res = await fetch(`/api/events/${eventId}/photos`, {
    method: 'POST',
    body: fd,
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? 'Upload failed');
  }
  const body = (await res.json()) as ApiPhoto & { message: ApiMessage | null };
  return {
    photo: toPhoto(body),
    message: body.message ? toMessage(body.message) : null,
  };
}
```

- [ ] **Step 2: Update `handleSubmit`**

In `web/src/App.tsx`, replace the `handleSubmit` body (the two-call block) with a single-call path:

```ts
  const handleSubmit = async (s: ContributeSubmission) => {
    if (!event) return;
    let uploaded: Photo | null = null;
    if (s.file) {
      const { photo, message } = await uploadPhoto(
        event.id,
        s.file,
        s.name || undefined,
        s.message || undefined,
      );
      uploaded = photo;
      setPhotosByEvent((prev) => ({
        ...prev,
        [event.id]: [...(prev[event.id] ?? []), photo],
      }));
      if (message) {
        setMessagesByEvent((prev) => ({
          ...prev,
          [event.id]: [...(prev[event.id] ?? []), message],
        }));
      }
    } else if (s.message) {
      const m = await postMessage(event.id, {
        name: s.name || undefined,
        text: s.message,
      });
      setMessagesByEvent((prev) => ({
        ...prev,
        [event.id]: [...(prev[event.id] ?? []), m],
      }));
    }
    const id = `tick-${Date.now()}`;
    setTickerEntry({
      id,
      name: s.name || 'A friend',
      photoUrl: uploaded?.url ?? s.previewUrl,
    });
    setTimeout(() => {
      setTickerEntry((cur) => (cur && cur.id === id ? null : cur));
    }, 4500);
  };
```

- [ ] **Step 3: Run the web suite**

Run: `npm run test:web -- --run`
Expected: PASS — `App.test.tsx` mocks only `fetchEvents`/`fetchPhotos`/`fetchMessages` and does not exercise submission, so it is unaffected.

- [ ] **Step 4: Commit**

```bash
git add web/src/lib/api.ts web/src/App.tsx
git commit -m "$(printf 'feat(web): submit photo + message in one atomic call\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

## Task 7: Deterministic pairing in `buildSequence` (+ message slide type & card)

Rewrite the sequencer to partition content into paired / plain / standalone pools, drop `photo` from the `message` slide type, render standalone messages on a mode-specific note card, and fix the affected test fixture. This task is committed only when web tests **and** `tsc` are clean.

**Files:**
- Modify: `web/src/lib/buildSequence.ts`, `web/src/types.ts` (the `SlideSpec` `message` variant), `web/src/components/slides/MessageSlide.tsx`
- Test: `web/src/test/buildSequence.test.ts`, `web/src/test/Wall.test.tsx`

- [ ] **Step 1: Write the failing pairing tests**

In `web/src/test/buildSequence.test.ts`, add `photoId: null` to the existing `makeMessages` factory (keeps those messages standalone) and add a linked-message factory + new cases:

```ts
const makeMessages = (n: number): Message[] =>
  Array.from({ length: n }, (_, i) => ({
    id: `m${i + 1}`,
    eventId: 'celebration',
    name: `Friend ${i + 1}`,
    text: `Message ${i + 1}`,
    createdAt: 2000 + i,
    photoId: null,
  }));

const makeLinkedMessages = (photos: Photo[]): Message[] =>
  photos.map((p, i) => ({
    id: `lm${i + 1}`,
    eventId: 'celebration',
    name: `Author ${i + 1}`,
    text: `Linked ${i + 1}`,
    createdAt: 3000 + i,
    photoId: p.id,
  }));

describe('buildSequence — pairing', () => {
  it('a linked message renders only with its own photo, as hero-msg', () => {
    const photos = makePhotos(6);
    const linked = makeLinkedMessages([photos[0]!]); // photoId === 'c1'
    const seq = buildSequence(photos, linked, 'celebration', event);
    const c1Slides = seq.filter(
      (s) => 'photos' in s && s.photos.some((p) => p.id === 'c1'),
    );
    expect(c1Slides.length).toBeGreaterThan(0);
    for (const s of c1Slides) {
      expect(s.type).toBe('hero-msg');
      expect((s as { message?: Message }).message?.id).toBe('lm1');
    }
    const carriers = seq.filter((s) => (s as { message?: Message }).message?.id === 'lm1');
    for (const s of carriers) {
      expect((s as { photos: Photo[] }).photos[0]!.id).toBe('c1');
    }
  });

  it('a hero-msg slide never carries a foreign message', () => {
    const photos = makePhotos(6);
    const linked = makeLinkedMessages([photos[0]!, photos[1]!]);
    const seq = buildSequence(photos, linked, 'celebration', event);
    const owner = new Map(linked.map((m) => [m.photoId, m.id]));
    for (const s of seq) {
      if (s.type === 'hero-msg') {
        const msg = (s as { message: Message | null }).message;
        if (msg) expect(msg.id).toBe(owner.get((s as { photos: Photo[] }).photos[0]!.id));
      }
    }
  });

  it('standalone messages render as message slides with no photo', () => {
    const seq = buildSequence(makePhotos(6), makeMessages(3), 'celebration', event);
    const msgSlides = seq.filter((s) => s.type === 'message');
    expect(msgSlides.length).toBeGreaterThan(0);
    for (const s of msgSlides) expect('photo' in s).toBe(false);
  });

  it('paired photos never appear in duo/triptych/polaroid', () => {
    const photos = makePhotos(8);
    const linked = makeLinkedMessages([photos[0]!, photos[1]!]);
    const seq = buildSequence(photos, linked, 'celebration', event);
    const linkedIds = new Set(linked.map((m) => m.photoId));
    for (const s of seq) {
      if (s.type === 'duo' || s.type === 'triptych' || s.type === 'polaroid') {
        for (const p of (s as { photos: Photo[] }).photos) {
          expect(linkedIds.has(p.id)).toBe(false);
        }
      }
    }
  });

  it('covers every photo and every standalone message', () => {
    const photos = makePhotos(9);
    const linked = makeLinkedMessages([photos[0]!, photos[1]!]);
    const standalone = makeMessages(3);
    const seq = buildSequence(photos, [...linked, ...standalone], 'celebration', event);
    const shownPhotos = new Set<string>();
    const shownMsgs = new Set<string>();
    for (const s of seq) {
      if ('photos' in s) s.photos.forEach((p) => shownPhotos.add(p.id));
      if (s.type === 'message') shownMsgs.add((s as { message: Message }).message.id);
      if (s.type === 'hero-msg') {
        const m = (s as { message: Message | null }).message;
        if (m) shownMsgs.add(m.id);
      }
    }
    photos.forEach((p) => expect(shownPhotos.has(p.id)).toBe(true));
    standalone.forEach((m) => expect(shownMsgs.has(m.id)).toBe(true));
  });
});
```

- [ ] **Step 2: Run the new tests to verify they fail**

Run: `npm run test:web -- --run src/test/buildSequence.test.ts`
Expected: FAIL — current `buildSequence` ignores `photoId`, places messages independently, and sets `photo` on `message` slides.

- [ ] **Step 3: Drop `photo` from the `message` slide type**

In `web/src/types.ts`, change the `message` variant of `SlideSpec`:

```ts
  | { id: string; type: 'message'; message: Message };
```

(Remove the `; photo: Photo` portion.)

- [ ] **Step 4: Rewrite `buildSequence`**

Replace the body of `buildSequence` in `web/src/lib/buildSequence.ts` (keep the two pattern constants and `MAX_ITERATIONS` unchanged):

```ts
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

  if (event) {
    seq.push({ id: 'title-0', type: 'title-card', event });
  }

  let pairedI = 0;
  let plainI = 0;
  let standI = 0;
  let pairedUsed = 0;
  let plainUsed = 0;
  let standUsed = 0;
  let ti = 0;
  let safety = 0;

  const nextPaired = (): Photo => {
    const p = paired[pairedI % paired.length]!;
    pairedI += 1;
    if (pairedUsed < paired.length) pairedUsed += 1;
    return p;
  };
  const nextPlain = (): Photo => {
    const p = plain[plainI % plain.length]!;
    plainI += 1;
    if (plainUsed < plain.length) plainUsed += 1;
    return p;
  };
  const nextStandalone = (): Message => {
    const m = standalone[standI % standalone.length]!;
    standI += 1;
    if (standUsed < standalone.length) standUsed += 1;
    return m;
  };

  const emitSingle = (photo: Photo): void => {
    const msg = msgByPhoto.get(photo.id);
    if (msg) {
      seq.push({ id: `s${ti}-${photo.id}-msg`, type: 'hero-msg', photos: [photo], message: msg });
    } else {
      seq.push({ id: `s${ti}-${photo.id}`, type: 'hero', photos: [photo] });
    }
  };

  const done = (): boolean =>
    pairedUsed >= paired.length && plainUsed >= plain.length && standUsed >= standalone.length;

  while (!done() && safety < MAX_ITERATIONS) {
    safety += 1;

    if (event && ti > 0 && ti % pattern.length === 0) {
      seq.push({ id: `title-${ti}`, type: 'title-card', event });
    }

    const token = pattern[ti % pattern.length]!;

    if (token === 'hero') {
      if (plain.length > 0) emitSingle(nextPlain());
      else if (paired.length > 0) emitSingle(nextPaired());
    } else if (token === 'hero-msg') {
      if (paired.length > 0) {
        emitSingle(nextPaired());
      } else if (plain.length > 0) {
        const p = nextPlain();
        seq.push({ id: `s${ti}-${p.id}-msg`, type: 'hero-msg', photos: [p], message: null });
      }
    } else if (token === 'duo') {
      if (plain.length > 0) {
        const a = nextPlain();
        const b = nextPlain();
        seq.push({ id: `s${ti}-${a.id}-${b.id}`, type: 'duo', photos: [a, b] });
      } else if (paired.length > 0) {
        emitSingle(nextPaired());
      }
    } else if (token === 'triptych') {
      if (plain.length > 0) {
        const a = nextPlain();
        const b = nextPlain();
        const c = nextPlain();
        seq.push({ id: `s${ti}-${a.id}-${b.id}-${c.id}`, type: 'triptych', photos: [a, b, c] });
      } else if (paired.length > 0) {
        emitSingle(nextPaired());
      }
    } else if (token === 'polaroid') {
      if (plain.length > 0) {
        const a = nextPlain();
        const b = nextPlain();
        const c = nextPlain();
        seq.push({
          id: `s${ti}-${a.id}-${b.id}-${c.id}-pol`,
          type: 'polaroid',
          photos: [a, b, c],
        });
      } else if (paired.length > 0) {
        emitSingle(nextPaired());
      }
    } else {
      // 'message'
      if (standalone.length > 0) {
        const m = nextStandalone();
        seq.push({ id: `s${ti}-msg-${m.id}`, type: 'message', message: m });
      } else if (plain.length > 0) {
        emitSingle(nextPlain());
      } else if (paired.length > 0) {
        emitSingle(nextPaired());
      }
    }

    ti += 1;
  }

  return seq;
}
```

- [ ] **Step 5: Run the buildSequence suite (new + existing)**

Run: `npm run test:web -- --run src/test/buildSequence.test.ts`
Expected: PASS — new pairing cases pass; existing cases still pass (with `makeMessages` now standalone, all six token types still appear, `hero-msg` slots render `message: null`, the imbalanced-input case still terminates under 300).

- [ ] **Step 6: Update `MessageSlide` to the mode-specific note card**

Replace `web/src/components/slides/MessageSlide.tsx` entirely:

```tsx
import type { Mode, SlideSpec } from '../../types';

interface Props {
  slide: Extract<SlideSpec, { type: 'message' }>;
  mode: Mode;
}

export function MessageSlide({ slide, mode }: Props) {
  const msg = slide.message;
  const isCele = mode === 'celebration';

  const cardShadow = isCele
    ? '0 30px 60px -20px rgba(60,30,10,0.45), 0 8px 18px -6px rgba(60,30,10,0.25)'
    : '0 30px 60px -22px rgba(20,30,55,0.40), 0 8px 18px -6px rgba(20,30,55,0.20)';

  return (
    <div className="absolute inset-0 bg-app paper overflow-hidden">
      <div
        className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 pointer-events-none"
        style={{
          width: 'min(72vh, 620px)',
          height: 'min(72vh, 620px)',
          borderRadius: '50%',
          background: isCele
            ? 'radial-gradient(circle, oklch(0.78 0.105 82 / 0.18) 0%, transparent 65%)'
            : 'radial-gradient(circle, oklch(0.72 0.060 85 / 0.10) 0%, transparent 65%)',
        }}
      ></div>

      <div className="absolute inset-0 flex items-center justify-center px-[8vw]">
        <div
          className="relative anim-fade-up"
          style={{
            width: 'min(600px, 56vw)',
            padding: 'clamp(2.2rem, 4vw, 3.6rem) clamp(2.4rem, 4.4vw, 4rem)',
            background: isCele ? '#fffdf8' : '#fcfdff',
            boxShadow: cardShadow,
            transform: isCele ? 'rotate(-3.2deg)' : 'none',
          }}
        >
          {isCele && (
            <div
              className="absolute"
              style={{
                top: '-15px',
                left: '50%',
                width: '128px',
                height: '30px',
                transform: 'translateX(-50%) rotate(2.5deg)',
                background: 'rgba(220, 200, 150, 0.42)',
                boxShadow: '0 1px 2px rgba(0,0,0,0.08)',
              }}
            ></div>
          )}

          <div className="flex items-center justify-center gap-3 mb-7">
            <span className="w-12 h-px" style={{ background: 'var(--ink-soft)' }}></span>
            <span className="mono text-[0.7rem] tracking-[0.28em] uppercase text-ink-soft">
              {isCele ? 'A note from' : 'In memory'}
            </span>
            <span className="w-12 h-px" style={{ background: 'var(--ink-soft)' }}></span>
          </div>

          <div
            className="serif text-ink text-center"
            style={{ fontSize: 'clamp(1.6rem, 3.4vw, 3.2rem)', lineHeight: 1.12, textWrap: 'balance' }}
          >
            {isCele ? <>&ldquo;{msg.text}&rdquo;</> : msg.text}
          </div>
          <div
            className="mt-7 serif-italic text-ink-soft text-center"
            style={{ fontSize: 'clamp(1rem, 1.5vw, 1.5rem)' }}
          >
            — {msg.name}
          </div>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 7: Fix the Wall test fixture**

In `web/src/test/Wall.test.tsx`: add `photoId: null` to the `seedMessage` fixture, and remove the `photo` field from the `message`-type slide literal in the "MessageSlide root has absolute class" test.

`seedMessage` becomes:

```ts
const seedMessage: Message = {
  id: 'm1',
  eventId: 'remembrance',
  name: 'A friend',
  text: 'We will remember.',
  createdAt: 0,
  photoId: null,
};
```

The message slide literal becomes:

```ts
    const slide = {
      id: 's3',
      type: 'message' as const,
      message: seedMessage,
    };
```

- [ ] **Step 8: Run the full web suite and typecheck**

Run: `npm run test:web -- --run`
Expected: PASS (all web suites).

Run: `npm run typecheck`
Expected: clean — no reference to `slide.photo` on a `message` slide remains; `Message.photoId` is satisfied everywhere.

> If `npm run typecheck` does not exist, run `tsc --noEmit -p web/tsconfig.json` (and `-p api/tsconfig.json`).

- [ ] **Step 9: Commit**

```bash
git add web/src/lib/buildSequence.ts web/src/types.ts web/src/components/slides/MessageSlide.tsx web/src/test/buildSequence.test.ts web/src/test/Wall.test.tsx
git commit -m "$(printf 'feat(web): pair messages to their photo in buildSequence + note card\n\nMessages with a photoId render only as hero-msg with their own photo;\nstandalone messages render on a mode-specific note card.\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

## Task 8: Browser verification of the note cards

Visual treatments aren't unit-tested (per the project test policy); verify them in the running app and tweak the card values against the approved prototype.

**Files:** none (verification; small style tweaks to `MessageSlide.tsx` only if needed)

- [ ] **Step 1: Run the app**

Use the project's run path (see the `run` skill / README). Typically: start the API and `web` dev server, open the event URL.

- [ ] **Step 2: Verify the remembrance card**

On a remembrance event, contribute a message with **no photo**. Confirm: an upright cool-white card centered on paper, soft cool shadow, `IN MEMORY` eyebrow with hairline rules, plain (no-quote) serif text, `— Name` attribution. No backdrop photo.

- [ ] **Step 3: Verify the celebration card**

On a celebration event, contribute a message with no photo. Confirm: a warm cream card tilted ~3°, tape strip over the top edge, `A NOTE FROM` eyebrow, quotation marks around the text.

- [ ] **Step 4: Verify pairing end-to-end**

Contribute a photo **with** a name and message. Confirm the message shows only on slides with that photo (as `hero-msg`), and never on another photo or a standalone card.

- [ ] **Step 5: Tweak and commit only if adjustments were made**

If you adjusted card values (tilt, shadow, tape, padding, type scale) in `MessageSlide.tsx`:

```bash
git add web/src/components/slides/MessageSlide.tsx
git commit -m "$(printf 'style(web): refine message note card against prototype\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

## Final verification

- [ ] `npm run test:api -- --run` → all pass
- [ ] `npm run test:web -- --run` → all pass
- [ ] `npm run typecheck` (or `tsc --noEmit` per package) → clean
- [ ] Manual smoke test matches the spec's Acceptance section:
  - photo + message → message only on that photo's slides
  - photo only → never carries a message
  - text-only → mode-specific note card, never on `hero-msg`
  - `POST …/photos` with a 300-char message → 400, no photo and no message row written
  - restart the API twice against a persisted DB → boots cleanly both times
