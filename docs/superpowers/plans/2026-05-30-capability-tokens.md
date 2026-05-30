# Capability Tokens (v0.3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Gate both write endpoints (`POST .../photos`, `POST .../messages`) behind an HMAC-signed, expiring capability token carried in the QR-poster URL fragment; all reads stay public; the API refuses to boot without a signing secret.

**Architecture:** A pure `token.ts` module owns sign/verify/mint (no Fastify coupling). `auth.ts` resolves the secret and builds a Fastify `preHandler` that enforces a valid token against the route's `:id`. The two write-route registrars take that preHandler and attach it to their `POST` only. The SPA reads the token from `window.location.hash` and sends it as `Authorization: Bearer <token>`; v0.2's inline error path surfaces `401` messages. No DB schema changes — tokens are stateless.

**Tech Stack:** TypeScript (ESM), Fastify 5, Node `crypto` (HMAC-SHA256), `tsx` (CLI), Vitest, React + Vite (web, jsdom test env).

---

## Spec ↔ reality reconciliation (read before starting)

The spec's "Files touched" lists `api/test/photos.test.ts` and `api/test/messages.test.ts`. **Those files do not exist.** Both the photo-upload and message `POST` tests live in a single file: `api/test/routes.test.ts`. All API integration test work in this plan targets `routes.test.ts`.

The spec also lists `web/src/lib/token.test.ts` and `web/src/lib/api.test.ts`. The web suite keeps tests in `web/src/test/` (e.g. `web/src/test/hash.test.ts` covers `web/src/lib/hash.ts`). This plan places the new web tests at `web/src/test/token.test.ts` and `web/src/test/api.test.ts`, importing from `../lib/...`, to match the existing convention.

---

## File map

| File | Action | Purpose |
|---|---|---|
| `api/src/lib/token.ts` | Create | `signToken`, `verifyToken`, `mintToken`, types |
| `api/test/token.test.ts` | Create | Unit tests for sign/verify/mint |
| `api/src/lib/auth.ts` | Create | `requireTokenSecret`, `makeRequireToken` |
| `api/test/auth.test.ts` | Create | Unit tests for `requireTokenSecret` |
| `api/src/cli/mintToken.ts` | Create | CLI wrapper around `mintToken` |
| `api/src/routes/photos.ts` | Modify | Accept `requireToken`, attach as `POST` preHandler |
| `api/src/routes/messages.ts` | Modify | Accept `requireToken`, attach as `POST` preHandler |
| `api/src/server.ts` | Modify | Resolve secret before listen; build + pass `requireToken` |
| `api/test/routes.test.ts` | Modify | Build app with token enforcement; auth all existing POSTs; add token matrix |
| `api/package.json` | Modify | `mint-token` script |
| `package.json` (root) | Modify | Convenience `mint-token` script |
| `web/src/lib/token.ts` | Create | `readToken` (parse `#t=`) |
| `web/src/test/token.test.ts` | Create | Unit tests for `readToken` |
| `web/src/lib/api.ts` | Modify | Thread `token` into `uploadPhoto`/`postMessage`; parse error in `postMessage` |
| `web/src/test/api.test.ts` | Create | Authorization header + error-surfacing tests |
| `web/src/App.tsx` | Modify | Read token once; pass to write calls |
| `docker-compose.yml` | Modify | Declare `TOKEN_SECRET` |
| `docker-compose.prod.yml` | Modify | Declare `TOKEN_SECRET` |
| `README.md` | Modify | "Capability tokens" section |

**Branch:** all work on a feature branch (e.g. `feat/capability-tokens`), not `main`. Create it before Task 1 if not already in an isolated worktree.

**Run commands** (from repo root `/home/aluxh/code/aluxh/mosaic`):
- API tests: `npm run test:api -- --run [test/file.test.ts]`
- Web tests: `npm run test:web -- --run [src/test/file.test.ts]`
- Typecheck: `npm --prefix api run typecheck` / `npm --prefix web run typecheck`

---

## Task 1: Token core — `signToken` + `verifyToken` (TDD)

**Files:**
- Create: `api/src/lib/token.ts`
- Create: `api/test/token.test.ts`

- [ ] **Step 1.1: Write the failing tests**

Create `api/test/token.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { signToken, verifyToken, type TokenPayload } from '../src/lib/token.js';

const SECRET = 'unit-test-secret';
const futurePayload: TokenPayload = { eid: 'remembrance', exp: 4_102_444_800 }; // year 2100

describe('signToken / verifyToken', () => {
  it('round-trips a freshly signed token', () => {
    const token = signToken(futurePayload, SECRET);
    const result = verifyToken(token, SECRET, 'remembrance');
    expect(result).toEqual({ ok: true, payload: futurePayload });
  });

  it('rejects a tampered payload segment with bad_signature', () => {
    const token = signToken(futurePayload, SECRET);
    const [seg1, sig] = token.split('.');
    const flipped = (seg1![0] === 'A' ? 'B' : 'A') + seg1!.slice(1);
    const result = verifyToken(`${flipped}.${sig}`, SECRET, 'remembrance');
    expect(result).toEqual({ ok: false, reason: 'bad_signature' });
  });

  it('rejects a tampered signature segment with bad_signature', () => {
    const token = signToken(futurePayload, SECRET);
    const [seg1, sig] = token.split('.');
    const flipped = (sig![0] === 'A' ? 'B' : 'A') + sig!.slice(1);
    const result = verifyToken(`${seg1}.${flipped}`, SECRET, 'remembrance');
    expect(result).toEqual({ ok: false, reason: 'bad_signature' });
  });

  it('rejects verification under a different secret with bad_signature', () => {
    const token = signToken(futurePayload, SECRET);
    expect(verifyToken(token, 'other-secret', 'remembrance')).toEqual({
      ok: false,
      reason: 'bad_signature',
    });
  });

  it('rejects an expired token (now injected)', () => {
    const token = signToken({ eid: 'remembrance', exp: 1000 }, SECRET);
    const result = verifyToken(token, SECRET, 'remembrance', 2000);
    expect(result).toEqual({ ok: false, reason: 'expired' });
  });

  it('rejects a token minted for a different event with wrong_event', () => {
    const token = signToken({ eid: 'celebration', exp: 4_102_444_800 }, SECRET);
    const result = verifyToken(token, SECRET, 'remembrance');
    expect(result).toEqual({ ok: false, reason: 'wrong_event' });
  });

  it('rejects a token with no dot as malformed', () => {
    expect(verifyToken('garbage', SECRET, 'remembrance')).toEqual({
      ok: false,
      reason: 'malformed',
    });
  });

  it('rejects empty segments as malformed', () => {
    expect(verifyToken('.abc', SECRET, 'remembrance')).toEqual({ ok: false, reason: 'malformed' });
    expect(verifyToken('abc.', SECRET, 'remembrance')).toEqual({ ok: false, reason: 'malformed' });
  });

  it('rejects a non-JSON payload with a valid-looking (but wrong) signature as bad_signature', () => {
    // Signature is checked before JSON.parse, so an unsigned non-JSON payload fails on signature.
    const seg1 = Buffer.from('not json').toString('base64url');
    const fakeSig = Buffer.from('deadbeef').toString('base64url');
    expect(verifyToken(`${seg1}.${fakeSig}`, SECRET, 'remembrance')).toEqual({
      ok: false,
      reason: 'bad_signature',
    });
  });

  it('does not throw on a length-mismatched signature (constant-time path)', () => {
    const token = signToken(futurePayload, SECRET);
    const [seg1] = token.split('.');
    expect(() => verifyToken(`${seg1}.x`, SECRET, 'remembrance')).not.toThrow();
    expect(verifyToken(`${seg1}.x`, SECRET, 'remembrance')).toEqual({
      ok: false,
      reason: 'bad_signature',
    });
  });
});
```

- [ ] **Step 1.2: Run the tests to verify they fail**

Run: `npm run test:api -- --run test/token.test.ts`
Expected: FAIL — `Cannot find module '../src/lib/token.js'`.

- [ ] **Step 1.3: Implement `api/src/lib/token.ts`**

```ts
import crypto from 'node:crypto';

export interface TokenPayload {
  eid: string;
  exp: number; // unix seconds
}

export type VerifyResult =
  | { ok: true; payload: TokenPayload }
  | { ok: false; reason: 'malformed' | 'bad_signature' | 'expired' | 'wrong_event' };

function hmac(secret: string, segment1: string): string {
  return crypto.createHmac('sha256', secret).update(segment1).digest('base64url');
}

// Constant-time string compare that never throws on length mismatch:
// hash both sides to a fixed 32-byte digest, then timingSafeEqual.
function safeEqual(a: string, b: string): boolean {
  const ha = crypto.createHash('sha256').update(a).digest();
  const hb = crypto.createHash('sha256').update(b).digest();
  return crypto.timingSafeEqual(ha, hb);
}

export function signToken(payload: TokenPayload, secret: string): string {
  const seg1 = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${seg1}.${hmac(secret, seg1)}`;
}

export function verifyToken(
  token: string,
  secret: string,
  eventId: string,
  now: number = Date.now() / 1000,
): VerifyResult {
  const parts = token.split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    return { ok: false, reason: 'malformed' };
  }
  const [seg1, sig] = parts as [string, string];

  if (!safeEqual(sig, hmac(secret, seg1))) {
    return { ok: false, reason: 'bad_signature' };
  }

  let payload: unknown;
  try {
    payload = JSON.parse(Buffer.from(seg1, 'base64url').toString('utf8'));
  } catch {
    return { ok: false, reason: 'malformed' };
  }

  const p = payload as Partial<TokenPayload>;
  if (typeof p.eid !== 'string' || typeof p.exp !== 'number') {
    return { ok: false, reason: 'malformed' };
  }
  if (p.eid !== eventId) return { ok: false, reason: 'wrong_event' };
  if (p.exp <= now) return { ok: false, reason: 'expired' };

  return { ok: true, payload: { eid: p.eid, exp: p.exp } };
}
```

- [ ] **Step 1.4: Run the tests to verify they pass**

Run: `npm run test:api -- --run test/token.test.ts`
Expected: PASS (all `signToken / verifyToken` cases).

- [ ] **Step 1.5: Commit**

```bash
git add api/src/lib/token.ts api/test/token.test.ts
git commit -m "$(printf 'feat(api): add HMAC capability token sign + verify\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

## Task 2: Token mint helper (TDD)

**Files:**
- Modify: `api/src/lib/token.ts`
- Modify: `api/test/token.test.ts`

- [ ] **Step 2.1: Write the failing tests — append to `api/test/token.test.ts`**

Add the `mintToken` import and a new `describe` block. Update the top import line:

```ts
import { signToken, verifyToken, mintToken, type TokenPayload } from '../src/lib/token.js';
```

Append at the end of the file:

```ts
describe('mintToken', () => {
  const SECRET = 'unit-test-secret';

  it('produces a token that verifies for its event', () => {
    const nowMs = 1_700_000_000_000;
    const r = mintToken({ secret: SECRET, eid: 'remembrance', ttlDays: 14, now: nowMs });
    const result = verifyToken(r.token, SECRET, 'remembrance', Math.floor(nowMs / 1000));
    expect(result.ok).toBe(true);
  });

  it('sets exp to floor(now/1000) + ttlDays*86400', () => {
    const nowMs = 1_700_000_000_000;
    const r = mintToken({ secret: SECRET, eid: 'remembrance', ttlDays: 14, now: nowMs });
    const decoded = verifyToken(r.token, SECRET, 'remembrance', Math.floor(nowMs / 1000));
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) return;
    expect(decoded.payload.exp).toBe(Math.floor(nowMs / 1000) + 14 * 86400);
  });

  it('builds the QR url from baseUrl when provided', () => {
    const r = mintToken({
      secret: SECRET,
      eid: 'remembrance',
      ttlDays: 14,
      baseUrl: 'https://event.example',
      now: 1_700_000_000_000,
    });
    expect(r.url).toBe(`https://event.example/#t=${r.token}`);
  });

  it('uses a placeholder host when baseUrl is absent', () => {
    const r = mintToken({ secret: SECRET, eid: 'remembrance', ttlDays: 14, now: 1_700_000_000_000 });
    expect(r.url).toBe(`https://<your-event-host>/#t=${r.token}`);
  });

  it('returns an ISO-8601 expiresAt', () => {
    const nowMs = 1_700_000_000_000;
    const r = mintToken({ secret: SECRET, eid: 'remembrance', ttlDays: 1, now: nowMs });
    expect(r.expiresAt).toBe(new Date((Math.floor(nowMs / 1000) + 86400) * 1000).toISOString());
  });
});
```

- [ ] **Step 2.2: Run the tests to verify they fail**

Run: `npm run test:api -- --run test/token.test.ts`
Expected: FAIL — `mintToken` is not exported.

- [ ] **Step 2.3: Implement `mintToken` — append to `api/src/lib/token.ts`**

```ts
export interface MintResult {
  token: string;
  expiresAt: string; // ISO-8601, for human display
  url: string;       // `${baseUrl}/#t=${token}` or a placeholder if baseUrl absent
}

export function mintToken(opts: {
  secret: string;
  eid: string;
  ttlDays: number;
  baseUrl?: string;
  now?: number; // unix ms; injectable for tests
}): MintResult {
  const nowMs = opts.now ?? Date.now();
  const exp = Math.floor(nowMs / 1000) + opts.ttlDays * 86400;
  const token = signToken({ eid: opts.eid, exp }, opts.secret);
  const host = opts.baseUrl ?? 'https://<your-event-host>';
  return {
    token,
    expiresAt: new Date(exp * 1000).toISOString(),
    url: `${host}/#t=${token}`,
  };
}
```

- [ ] **Step 2.4: Run the tests to verify they pass**

Run: `npm run test:api -- --run test/token.test.ts`
Expected: PASS (sign/verify + mint).

- [ ] **Step 2.5: Commit**

```bash
git add api/src/lib/token.ts api/test/token.test.ts
git commit -m "$(printf 'feat(api): add mintToken helper for operator CLI\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

## Task 3: Auth module — secret resolution + preHandler factory (TDD)

**Files:**
- Create: `api/src/lib/auth.ts`
- Create: `api/test/auth.test.ts`

`makeRequireToken` is exercised end-to-end in Task 4's route matrix; this task unit-tests `requireTokenSecret` (per spec) and implements both functions.

- [ ] **Step 3.1: Write the failing tests**

Create `api/test/auth.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { requireTokenSecret } from '../src/lib/auth.js';

describe('requireTokenSecret', () => {
  it('returns the secret when set', () => {
    expect(requireTokenSecret({ TOKEN_SECRET: 's3cret' } as NodeJS.ProcessEnv)).toBe('s3cret');
  });

  it('throws when missing; message mentions TOKEN_SECRET and mint-token', () => {
    expect(() => requireTokenSecret({} as NodeJS.ProcessEnv)).toThrow(/TOKEN_SECRET/);
    expect(() => requireTokenSecret({} as NodeJS.ProcessEnv)).toThrow(/mint-token/);
  });

  it('throws on an empty string', () => {
    expect(() => requireTokenSecret({ TOKEN_SECRET: '' } as NodeJS.ProcessEnv)).toThrow();
  });
});
```

- [ ] **Step 3.2: Run the tests to verify they fail**

Run: `npm run test:api -- --run test/auth.test.ts`
Expected: FAIL — `Cannot find module '../src/lib/auth.js'`.

- [ ] **Step 3.3: Implement `api/src/lib/auth.ts`**

```ts
import type { preHandlerHookHandler } from 'fastify';
import { verifyToken } from './token.js';

const MISSING_SECRET_MSG = `TOKEN_SECRET is not set. Mosaic v0.3 requires a signing secret for upload
tokens. Set TOKEN_SECRET (a long random string), then run \`npm run
mint-token\` to generate the QR URL guests will scan. See README →
"Capability tokens".`;

const SCAN_MSG = "This link can't be used to upload — scan the QR code at the event.";
const EXPIRED_MSG = 'This event is no longer accepting uploads — ask the host for a new code.';

export function requireTokenSecret(env: NodeJS.ProcessEnv): string {
  const secret = env.TOKEN_SECRET;
  if (!secret || secret.length === 0) {
    throw new Error(MISSING_SECRET_MSG);
  }
  return secret;
}

export function makeRequireToken(secret: string): preHandlerHookHandler {
  return async (req, reply) => {
    const auth = req.headers.authorization;
    if (!auth || !auth.startsWith('Bearer ')) {
      return reply.code(401).send({ error: SCAN_MSG });
    }
    const token = auth.slice('Bearer '.length);
    const eventId = (req.params as { id: string }).id;
    const result = verifyToken(token, secret, eventId);
    if (!result.ok) {
      const msg = result.reason === 'expired' ? EXPIRED_MSG : SCAN_MSG;
      return reply.code(401).send({ error: msg });
    }
  };
}
```

- [ ] **Step 3.4: Run the tests to verify they pass**

Run: `npm run test:api -- --run test/auth.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 3.5: Commit**

```bash
git add api/src/lib/auth.ts api/test/auth.test.ts
git commit -m "$(printf 'feat(api): add token secret resolver + Bearer preHandler\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

## Task 4: Gate the write routes + wire the server (TDD)

The two write-route registrars gain a `requireToken` preHandler attached to their `POST`. `server.ts` resolves the secret before listening and passes the preHandler in. The integration tests in `routes.test.ts` build the app with enforcement, send a valid `Authorization` header on every existing `POST`, and add the rejection matrix.

**Files:**
- Modify: `api/test/routes.test.ts`
- Modify: `api/src/routes/photos.ts`
- Modify: `api/src/routes/messages.ts`
- Modify: `api/src/server.ts`

- [ ] **Step 4.1: Update `api/test/routes.test.ts` — enforce tokens, auth existing POSTs, add matrix**

Add these imports after the existing imports (top of file):

```ts
import { makeRequireToken } from '../src/lib/auth.js';
import { signToken } from '../src/lib/token.js';
```

Add a secret + auth helpers below the imports (e.g. after the `SCHEMA` constant):

```ts
const TEST_SECRET = 'routes-test-secret';

const validAuth = (eid = 'remembrance'): string =>
  `Bearer ${signToken({ eid, exp: Math.floor(Date.now() / 1000) + 3600 }, TEST_SECRET)}`;
const expiredAuth = (eid = 'remembrance'): string =>
  `Bearer ${signToken({ eid, exp: Math.floor(Date.now() / 1000) - 10 }, TEST_SECRET)}`;
const badSigAuth = (eid = 'remembrance'): string =>
  `Bearer ${signToken({ eid, exp: Math.floor(Date.now() / 1000) + 3600 }, 'wrong-secret')}`;
```

Replace `buildApp` so it constructs the preHandler and passes it to both write registrars:

```ts
async function buildApp() {
  app = Fastify();
  await app.register(multipart, { limits: { fileSize: 10 * 1024 * 1024 } });
  const requireToken = makeRequireToken(TEST_SECRET);
  registerEventRoutes(app, db);
  registerMessageRoutes(app, db, requireToken);
  registerPhotoRoutes(app, db, paths, requireToken);
  await app.ready();
}
```

In `describe('POST /api/events/:id/messages', ...)`, add `headers: { authorization: validAuth() }` to **all three existing POST `app.inject` calls** (rejects empty text, rejects over 240, persists a valid message, falls back to "A friend"). The preHandler runs before the handler, so without a token these now return `401`, not the asserted `400`/`201`. Example for the first one:

```ts
  it('rejects empty text', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/events/remembrance/messages',
      headers: { authorization: validAuth() },
      payload: { text: '   ' },
    });
    expect(res.statusCode).toBe(400);
  });
```

Apply the same `headers: { authorization: validAuth() }` addition to the other three message POSTs.

In `describe('POST /api/events/:id/photos', ...)`, give the two helpers a default auth header so existing tests keep passing and the matrix can override:

```ts
  async function uploadBuffer(
    buf: Buffer,
    filename: string,
    contentType: string,
    authHeader: string | null = validAuth(),
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
      headers: {
        'content-type': `multipart/form-data; boundary=${boundary}`,
        ...(authHeader ? { authorization: authHeader } : {}),
      },
      payload: body,
    });
  }
```

```ts
  function uploadWithFields(
    buf: Buffer,
    filename: string,
    contentType: string,
    fields: Record<string, string>,
    authHeader: string | null = validAuth(),
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
      headers: {
        'content-type': `multipart/form-data; boundary=${boundary}`,
        ...(authHeader ? { authorization: authHeader } : {}),
      },
      payload: Buffer.concat(parts),
    });
  }
```

The "rejects an empty form (no file)" photo test inlines its own `app.inject` (it does not use `uploadBuffer`). Add an auth header to it so it still reaches the `400`:

```ts
  it('rejects an empty form (no file)', async () => {
    const boundary = '----test-boundary';
    const body = Buffer.from(`--${boundary}--\r\n`);
    const res = await app.inject({
      method: 'POST',
      url: '/api/events/remembrance/photos',
      headers: {
        'content-type': `multipart/form-data; boundary=${boundary}`,
        authorization: validAuth(),
      },
      payload: body,
    });
    expect(res.statusCode).toBe(400);
  });
```

Now add the token matrix. Append a new `describe` block at the end of the file (it reuses the same `app`/`paths` from the outer `beforeEach`):

```ts
describe('write-endpoint token enforcement', () => {
  const SCAN_MSG = "This link can't be used to upload — scan the QR code at the event.";
  const EXPIRED_MSG = 'This event is no longer accepting uploads — ask the host for a new code.';

  function postMessage(authHeader: string | null) {
    return app.inject({
      method: 'POST',
      url: '/api/events/remembrance/messages',
      headers: authHeader ? { authorization: authHeader } : {},
      payload: { text: 'hello' },
    });
  }

  function postPhoto(authHeader: string | null) {
    const boundary = '----tok-boundary';
    const parts: Buffer[] = [
      Buffer.from(`--${boundary}\r\n`),
      Buffer.from(
        'Content-Disposition: form-data; name="file"; filename="p.png"\r\nContent-Type: image/png\r\n\r\n',
      ),
      minimalPng,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ];
    return app.inject({
      method: 'POST',
      url: '/api/events/remembrance/photos',
      headers: {
        'content-type': `multipart/form-data; boundary=${boundary}`,
        ...(authHeader ? { authorization: authHeader } : {}),
      },
      payload: Buffer.concat(parts),
    });
  }

  it('messages: 401 + scan message with no Authorization header', async () => {
    const res = await postMessage(null);
    expect(res.statusCode).toBe(401);
    expect((res.json() as { error: string }).error).toBe(SCAN_MSG);
  });

  it('messages: 401 + expired message with an expired token', async () => {
    const res = await postMessage(expiredAuth());
    expect(res.statusCode).toBe(401);
    expect((res.json() as { error: string }).error).toBe(EXPIRED_MSG);
  });

  it('messages: 401 with a bad-signature token', async () => {
    expect((await postMessage(badSigAuth())).statusCode).toBe(401);
  });

  it('messages: 401 with a token minted for another event', async () => {
    expect((await postMessage(validAuth('celebration'))).statusCode).toBe(401);
  });

  it('photos: 401 + scan message with no Authorization header', async () => {
    const res = await postPhoto(null);
    expect(res.statusCode).toBe(401);
    expect((res.json() as { error: string }).error).toBe(SCAN_MSG);
  });

  it('photos: 401 + expired message with an expired token', async () => {
    const res = await postPhoto(expiredAuth());
    expect(res.statusCode).toBe(401);
    expect((res.json() as { error: string }).error).toBe(EXPIRED_MSG);
  });

  it('photos: 401 with a bad-signature token', async () => {
    expect((await postPhoto(badSigAuth())).statusCode).toBe(401);
  });

  it('photos: 401 with a token minted for another event', async () => {
    expect((await postPhoto(validAuth('celebration'))).statusCode).toBe(401);
  });

  it('reads stay public — GET photos and messages need no token', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/events/remembrance/photos' })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/api/events/remembrance/messages' })).statusCode).toBe(200);
  });
});
```

- [ ] **Step 4.2: Run the tests to verify they fail**

Run: `npm run test:api -- --run test/routes.test.ts`
Expected: FAIL — `registerMessageRoutes`/`registerPhotoRoutes` do not accept a `requireToken` argument (TypeScript error), and the matrix's `401` expectations don't hold because no preHandler is attached yet.

- [ ] **Step 4.3: Update `api/src/routes/messages.ts`**

Change the import and the registrar signature; attach the preHandler to the `POST` route. The handler body is unchanged.

```ts
import type { FastifyInstance, preHandlerHookHandler } from 'fastify';
```

```ts
export function registerMessageRoutes(
  app: FastifyInstance,
  db: DB,
  requireToken: preHandlerHookHandler,
): void {
  app.post<{ Params: { id: string }; Body: PostBody }>(
    '/api/events/:id/messages',
    { preHandler: requireToken },
    async (req, reply) => {
      // ...unchanged body...
    },
  );
}
```

- [ ] **Step 4.4: Update `api/src/routes/photos.ts`**

Change the import and the registrar signature; attach the preHandler. The handler body is unchanged.

```ts
import type { FastifyInstance, preHandlerHookHandler } from 'fastify';
```

```ts
export function registerPhotoRoutes(
  app: FastifyInstance,
  db: DB,
  paths: StoragePaths,
  requireToken: preHandlerHookHandler,
): void {
  app.post<{ Params: { id: string } }>(
    '/api/events/:id/photos',
    { preHandler: requireToken },
    async (req, reply) => {
      // ...unchanged body...
    },
  );
}
```

- [ ] **Step 4.5: Update `api/src/server.ts`**

Add the import:

```ts
import { requireTokenSecret, makeRequireToken } from './lib/auth.js';
```

Resolve the secret as the **first** statement in `main()` (a throw here propagates to the existing `main().catch` → `console.error` → `process.exit(1)`, so the app never starts listening without a secret):

```ts
async function main() {
  const tokenSecret = requireTokenSecret(process.env);
  const paths = makeStoragePaths(DATA_DIR);
  // ...rest unchanged until route registration...
```

Replace the route-registration block (currently lines registering events/messages/photos):

```ts
  const requireToken = makeRequireToken(tokenSecret);
  registerEventRoutes(app, db);
  registerMessageRoutes(app, db, requireToken);
  registerPhotoRoutes(app, db, paths, requireToken);
```

- [ ] **Step 4.6: Run the routes suite to verify it passes**

Run: `npm run test:api -- --run test/routes.test.ts`
Expected: PASS — existing POSTs pass with the valid token; the matrix's `401`s hold; GETs stay `200`.

- [ ] **Step 4.7: Run the full API suite + typecheck**

Run: `npm run test:api -- --run`
Run: `npm --prefix api run typecheck`
Expected: all API suites pass; `tsc --noEmit` clean (the registrar signature change is reflected in `server.ts` and `routes.test.ts`).

- [ ] **Step 4.8: Commit**

```bash
git add api/src/routes/photos.ts api/src/routes/messages.ts api/src/server.ts api/test/routes.test.ts
git commit -m "$(printf 'feat(api): gate write routes behind capability token preHandler\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

## Task 5: Operator mint CLI + npm scripts

`mintToken` logic is already unit-tested (Task 2); the CLI is a thin wrapper verified by running it.

**Files:**
- Create: `api/src/cli/mintToken.ts`
- Modify: `api/package.json`
- Modify: `package.json` (root)

- [ ] **Step 5.1: Implement `api/src/cli/mintToken.ts`**

```ts
import { requireTokenSecret } from '../lib/auth.js';
import { mintToken } from '../lib/token.js';
import { resolveEventMode } from '../lib/seedEvents.js';

function main(): void {
  const secret = requireTokenSecret(process.env);
  const ttlDays = Number(process.env.TOKEN_TTL_DAYS) || 14;
  const eid = resolveEventMode();
  const baseUrl = process.argv[2]; // optional

  const result = mintToken({ secret, eid, ttlDays, baseUrl });
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

- [ ] **Step 5.2: Add the API package script**

In `api/package.json`, add to `"scripts"` (after `"start"`):

```json
    "mint-token": "tsx src/cli/mintToken.ts",
```

- [ ] **Step 5.3: Add the root convenience script**

In root `package.json`, add to `"scripts"` (after `"test:api"`):

```json
    "mint-token": "npm --prefix api run mint-token --"
```

- [ ] **Step 5.4: Verify the CLI — missing secret exits non-zero with the instructional error**

Run: `unset TOKEN_SECRET; npm --prefix api run mint-token`
Expected: prints the `TOKEN_SECRET is not set...` message, exits non-zero.

- [ ] **Step 5.5: Verify the CLI — with a secret it prints token, expiry, URL**

Run: `TOKEN_SECRET=dev-secret EVENT_MODE=remembrance npm --prefix api run mint-token -- https://event.example`
Expected: three lines — the token, `Expires: <ISO date>`, and `https://event.example/#t=<token>`.

- [ ] **Step 5.6: Verify the root passthrough**

Run: `TOKEN_SECRET=dev-secret EVENT_MODE=remembrance npm run mint-token -- https://event.example`
Expected: same three lines.

- [ ] **Step 5.7: Commit**

```bash
git add api/src/cli/mintToken.ts api/package.json package.json
git commit -m "$(printf 'feat(api): add mint-token CLI for QR URL generation\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

## Task 6: Frontend — read token from URL fragment (TDD)

**Files:**
- Create: `web/src/lib/token.ts`
- Create: `web/src/test/token.test.ts`

- [ ] **Step 6.1: Write the failing tests**

Create `web/src/test/token.test.ts` (web test env is jsdom per `vite.config.ts`, so `window.location` exists):

```ts
import { afterEach, describe, expect, it } from 'vitest';
import { readToken } from '../lib/token';

afterEach(() => {
  window.location.hash = '';
});

describe('readToken', () => {
  it('parses #t=abc', () => {
    window.location.hash = '#t=abc';
    expect(readToken()).toBe('abc');
  });

  it('parses #t=abc&x=1', () => {
    window.location.hash = '#t=abc&x=1';
    expect(readToken()).toBe('abc');
  });

  it('returns null when there is no fragment', () => {
    window.location.hash = '';
    expect(readToken()).toBeNull();
  });

  it('returns null when the fragment lacks t', () => {
    window.location.hash = '#x=1';
    expect(readToken()).toBeNull();
  });
});
```

- [ ] **Step 6.2: Run the tests to verify they fail**

Run: `npm run test:web -- --run src/test/token.test.ts`
Expected: FAIL — `Cannot find module '../lib/token'`.

- [ ] **Step 6.3: Implement `web/src/lib/token.ts`**

```ts
// Parses `#t=<token>` from the current URL fragment. Returns null if absent.
export function readToken(): string | null {
  return new URLSearchParams(window.location.hash.replace(/^#/, '')).get('t');
}
```

- [ ] **Step 6.4: Run the tests to verify they pass**

Run: `npm run test:web -- --run src/test/token.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 6.5: Commit**

```bash
git add web/src/lib/token.ts web/src/test/token.test.ts
git commit -m "$(printf 'feat(web): read capability token from URL fragment\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

## Task 7: Frontend — thread token through the API client (TDD)

`uploadPhoto` and `postMessage` each take an optional `token` and set `Authorization: Bearer <token>` when present. `postMessage` also starts parsing `body.error` from non-OK responses so `401` guest messages reach the UI the same way `uploadPhoto` already does.

**Files:**
- Create: `web/src/test/api.test.ts`
- Modify: `web/src/lib/api.ts`

- [ ] **Step 7.1: Write the failing tests**

Create `web/src/test/api.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from 'vitest';
import { uploadPhoto, postMessage } from '../lib/api';

const okPhoto = {
  id: 'p1',
  event_id: 'remembrance',
  source: 'upload',
  url: '/data/uploads/remembrance/p1.png',
  credit: 'Maya',
  created_at: 1,
  message: null,
};
const okMessage = {
  id: 'm1',
  event_id: 'remembrance',
  name: 'A friend',
  text: 'hi',
  created_at: 1,
  photo_id: null,
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('uploadPhoto', () => {
  it('sets a Bearer header when a token is provided', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => okPhoto });
    vi.stubGlobal('fetch', fetchMock);
    const file = new File(['x'], 'p.png', { type: 'image/png' });
    await uploadPhoto('remembrance', file, 'Maya', undefined, 'tok123');
    expect(fetchMock.mock.calls[0]![1].headers).toMatchObject({ Authorization: 'Bearer tok123' });
  });

  it('sends no Authorization header when no token is provided', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => okPhoto });
    vi.stubGlobal('fetch', fetchMock);
    const file = new File(['x'], 'p.png', { type: 'image/png' });
    await uploadPhoto('remembrance', file);
    expect(fetchMock.mock.calls[0]![1].headers).toBeUndefined();
  });
});

describe('postMessage', () => {
  it('sets a Bearer header when a token is provided', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => okMessage });
    vi.stubGlobal('fetch', fetchMock);
    await postMessage('remembrance', { text: 'hi' }, 'tok123');
    expect(fetchMock.mock.calls[0]![1].headers).toMatchObject({ Authorization: 'Bearer tok123' });
  });

  it('surfaces the server error string on a 401', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({ error: "This link can't be used to upload — scan the QR code at the event." }),
    });
    vi.stubGlobal('fetch', fetchMock);
    await expect(postMessage('remembrance', { text: 'hi' })).rejects.toThrow(
      "This link can't be used to upload — scan the QR code at the event.",
    );
  });
});
```

- [ ] **Step 7.2: Run the tests to verify they fail**

Run: `npm run test:web -- --run src/test/api.test.ts`
Expected: FAIL — `uploadPhoto`/`postMessage` don't accept a `token` arg / don't set the header; `postMessage` throws the generic `message -> 401` string.

- [ ] **Step 7.3: Update `web/src/lib/api.ts`**

Replace `uploadPhoto`:

```ts
export async function uploadPhoto(
  eventId: string,
  file: File,
  name?: string,
  message?: string,
  token?: string,
): Promise<{ photo: Photo; message: Message | null }> {
  const fd = new FormData();
  fd.append('file', file);
  if (name) fd.append('credit', name);
  if (message) fd.append('message', message);
  const res = await fetch(`/api/events/${eventId}/photos`, {
    method: 'POST',
    body: fd,
    ...(token ? { headers: { Authorization: `Bearer ${token}` } } : {}),
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

Replace `postMessage`:

```ts
export async function postMessage(
  eventId: string,
  body: { name?: string; text: string },
  token?: string,
): Promise<Message> {
  const res = await fetch(`/api/events/${eventId}/messages`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const b = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(b.error ?? `message -> ${res.status}`);
  }
  return toMessage((await res.json()) as ApiMessage);
}
```

> Note: for `uploadPhoto` (multipart `FormData`), only the `Authorization` header is set — never a manual `content-type`, so the browser keeps control of the multipart boundary. The "no token" test asserts `headers` is `undefined`, which holds because nothing is spread in.

- [ ] **Step 7.4: Run the tests to verify they pass**

Run: `npm run test:web -- --run src/test/api.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 7.5: Commit**

```bash
git add web/src/lib/api.ts web/src/test/api.test.ts
git commit -m "$(printf 'feat(web): send Bearer token + surface 401 errors in API client\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

## Task 8: Frontend — read the token once and pass it to write calls

No new unit test: this is wiring covered by the existing `App.test.tsx` (which mocks only the read calls) and the typecheck. The contribute sheet needs **no** change — v0.2 already renders the server's error string inline.

**Files:**
- Modify: `web/src/App.tsx`

- [ ] **Step 8.1: Import `readToken` and read it once**

Add the import alongside the other `./lib/...` imports:

```ts
import { readToken } from './lib/token';
```

Inside `App`, after the `event` memo (around the existing `const event = useMemo(...)`), add:

```ts
  const token = useMemo(() => readToken() ?? undefined, []);
```

(`useMemo` is already imported.)

- [ ] **Step 8.2: Pass the token into the write calls in `handleSubmit`**

Update the `uploadPhoto` call:

```ts
      const { photo, message } = await uploadPhoto(
        event.id,
        s.file,
        s.name || undefined,
        s.message || undefined,
        token,
      );
```

Update the `postMessage` call:

```ts
      const m = await postMessage(
        event.id,
        { name: s.name || undefined, text: s.message },
        token,
      );
```

- [ ] **Step 8.3: Run the full web suite + typecheck**

Run: `npm run test:web -- --run`
Run: `npm --prefix web run typecheck`
Expected: all web suites pass; `tsc --noEmit` clean.

- [ ] **Step 8.4: Commit**

```bash
git add web/src/App.tsx
git commit -m "$(printf 'feat(web): pass capability token into photo + message submits\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

## Task 9: Configuration + docs

**Files:**
- Modify: `docker-compose.yml`
- Modify: `docker-compose.prod.yml`
- Modify: `README.md`

- [ ] **Step 9.1: Declare `TOKEN_SECRET` in the dev compose**

In `docker-compose.yml`, under `services.api.environment`, add after the `EVENT_SHORT_CODE` line:

```yaml
      TOKEN_SECRET: ${TOKEN_SECRET:-}
      # TOKEN_TTL_DAYS: "14"   # validity window for newly minted tokens
```

- [ ] **Step 9.2: Declare `TOKEN_SECRET` in the prod compose**

In `docker-compose.prod.yml`, under `services.api.environment`, add after the `EVENT_MODE` line (before the commented `EVENT_*` overrides):

```yaml
      # REQUIRED (v0.3+): HMAC signing key for upload tokens. The API will
      # NOT boot if this is empty. Generate with: openssl rand -hex 32
      # Rotating this value invalidates every outstanding QR token at once.
      TOKEN_SECRET: ""
      # TOKEN_TTL_DAYS: "14"   # validity window for newly minted tokens
```

- [ ] **Step 9.3: Add the "Capability tokens" section to the README**

In `README.md`, insert a new section immediately **before** the `### Secrets policy` heading (so it lives inside "Deploying to Synology"):

```markdown
### Capability tokens (v0.3+)

Both write endpoints (`POST .../photos`, `POST .../messages`) require a
signed token. Reads (the slideshow, the TV display) stay public and need no
token. Scanning the event's QR poster is the only way to get a working
token; the bare URL is read-only.

1. **Set a signing secret.** Generate a long random string and set it as
   `TOKEN_SECRET` on the `api` service in your compose file:

   ```bash
   openssl rand -hex 32
   ```

   The API refuses to boot if `TOKEN_SECRET` is empty — there is no
   accidentally-open mode.

2. **Mint a token + QR URL.** After deploying with the secret set:

   ```bash
   docker compose exec api npm run mint-token -- https://your-event-host
   ```

   This prints the token, its expiry date, and the ready-to-paste URL of the
   form `https://your-event-host/#t=<token>`. The token defaults to a 14-day
   validity window; override with `TOKEN_TTL_DAYS`.

3. **Encode the printed URL into the QR poster.** Guests who scan it land in
   the app with a working token; their uploads and notes are accepted.

4. **Extend the window:** re-run `mint-token` for a fresh token with a later
   expiry and reprint the QR. Old tokens remain valid until their own expiry.

5. **Kill switch:** change `TOKEN_SECRET` and redeploy — every outstanding
   token is invalidated immediately. Mint a new one to resume.

> **Upgrading a live event is a breaking, one-time step.** Turning
> enforcement on invalidates every existing QR poster (old URLs carry no
> token). Set `TOKEN_SECRET` → `mint-token` → reprint the QR.
```

- [ ] **Step 9.4: Verify the boot guard end-to-end**

Run: `unset TOKEN_SECRET; npm --prefix api run start`
Expected: prints the `TOKEN_SECRET is not set...` error and exits non-zero; nothing listens. (Stop here — this is the failure path.)

Run: `TOKEN_SECRET=dev-secret EVENT_MODE=remembrance npm --prefix api run start`
Expected: boots normally and logs `Mosaic API listening on ...`. Ctrl-C to stop.

- [ ] **Step 9.5: Commit**

```bash
git add docker-compose.yml docker-compose.prod.yml README.md
git commit -m "$(printf 'docs(ops): document TOKEN_SECRET + mint-token capability flow\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

## Task 10: Browser smoke verification

Manual end-to-end check against the running app (matches the spec's Acceptance "Manual browser smoke").

**Files:** none (verification only).

- [ ] **Step 10.1: Start the app with a known secret**

Run the API with `TOKEN_SECRET=dev-secret` set, plus the web dev server (`npm run dev` starts both; export `TOKEN_SECRET` in that shell first). Mint a token: `TOKEN_SECRET=dev-secret npm run mint-token -- http://localhost:5173`.

- [ ] **Step 10.2: Upload succeeds with a token**

Open `http://localhost:5173/#t=<minted token>`. Open the contribute sheet, upload a photo (optionally with a note) → it succeeds and appears in rotation.

- [ ] **Step 10.3: Upload is rejected without a token**

Open `http://localhost:5173/` (no fragment). Open the contribute sheet, attempt an upload → the sheet shows the inline message: "This link can't be used to upload — scan the QR code at the event."

---

## Final verification

- [ ] `npm run test:api -- --run` → all pass (incl. `token.test.ts`, `auth.test.ts`, extended `routes.test.ts`)
- [ ] `npm run test:web -- --run` → all pass (incl. `token.test.ts`, `api.test.ts`)
- [ ] `npm --prefix api run typecheck` and `npm --prefix web run typecheck` → clean
- [ ] **Boot guard:** API with `TOKEN_SECRET` unset exits non-zero with the instructional error; with it set, boots normally
- [ ] **Mint:** `npm run mint-token -- https://event.example` prints token, ISO expiry, and `https://event.example/#t=<token>`
- [ ] **Manual API smoke** (dev API, known secret):
  - `POST` upload, no `Authorization` → `401`, "scan the QR" message
  - `POST` with `Authorization: Bearer <minted>` → `201`
  - `POST` with an expired token → `401`, "no longer accepting" message
  - `GET .../photos` with no header → `200`

---

## Self-review

### Spec coverage check

| Spec requirement | Task |
|---|---|
| Gate both write endpoints, `401` otherwise | Task 4 (preHandler) |
| Keep all reads public | Task 4 (GET unchanged + public-read test) |
| Stateless, expiring HMAC tokens | Task 1 (`signToken`/`verifyToken`) |
| Mandatory secret, refuse to boot without it | Task 3 (`requireTokenSecret`) + Task 4 (`server.ts`) |
| Operator mint CLI (token, expiry, URL) | Task 5 |
| Guest-facing rejection inline | Task 7 (`postMessage` error parse) + Task 8 (v0.2 sheet path) |
| Token shape: `b64url(payload).b64url(hmac)` | Task 1 |
| `verifyToken` check order + constant-time compare | Task 1 (`safeEqual` double-hash) |
| `mintToken` exp formula + url/placeholder | Task 2 |
| Secret resolution + Bearer preHandler + reason→message map | Task 3 |
| `server.ts` resolve-before-listen + pass preHandler | Task 4 |
| Route registrars take `requireToken`, attach to POST only | Task 4 |
| CLI + `api`/root `mint-token` scripts | Task 5 |
| `web/src/lib/token.ts` `readToken` (fragment) | Task 6 |
| `api.ts` thread token + `postMessage` error parse | Task 7 |
| `App.tsx` read token once, pass to write calls | Task 8 |
| `TOKEN_SECRET` / `TOKEN_TTL_DAYS` config table | Task 9 (compose) |
| README "Capability tokens" section | Task 9 |
| No DB schema change | Honored — no migration task |

### Placeholder scan

None. Every code step contains complete code; `https://<your-event-host>` is the spec's intended literal placeholder string, not a plan gap.

### Type / name consistency

- `signToken(payload, secret)`, `verifyToken(token, secret, eventId, now?)`, `mintToken(opts)` — identical signatures across Tasks 1, 2, 5, and the routes test helper.
- `VerifyResult.reason` values (`malformed`/`bad_signature`/`expired`/`wrong_event`) match the reason→message mapping in `makeRequireToken` (Task 3) and the matrix assertions (Task 4).
- `requireToken: preHandlerHookHandler` — same type in `auth.ts`, both registrars, `server.ts`, and `buildApp`.
- `registerMessageRoutes(app, db, requireToken)` and `registerPhotoRoutes(app, db, paths, requireToken)` — call sites in `server.ts` and `routes.test.ts` match the new signatures.
- Web `uploadPhoto(eventId, file, name?, message?, token?)` and `postMessage(eventId, body, token?)` — call sites in `App.tsx` (Task 8) and tests (Task 7) match.

### Breaking changes to existing tests (all addressed)

- `routes.test.ts`: `buildApp` now builds and passes `requireToken`; every existing `POST` (messages + photos) sends `validAuth()`; the inline empty-form photo test gets an auth header — all in Task 4.
- `App.test.tsx`: unaffected — it mocks only `fetchEvents`/`fetchPhotos`/`fetchMessages` and never exercises submission; `readToken()` returns `null` under jsdom with no fragment.
```
