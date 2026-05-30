# Boot-time Token Log Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mint a capability token on every API boot and print it (token + expiry, plus the full `#t=` URL when `BASE_URL` is set) to stdout, so Dockhand operators get a QR URL from the log viewer without SSH.

**Architecture:** Add one pure function `formatBootToken` next to the existing `mintToken` in `api/src/lib/token.ts` that builds the human-readable log lines (omitting the URL line when no `baseUrl` is given). Wire `server.ts` to call `mintToken` + `formatBootToken` after `app.listen`, emitting the lines via `console.log`. No DB, route, or token-shape changes.

**Tech Stack:** TypeScript (ESM, `.js` import specifiers), Fastify, Vitest, Node `crypto`.

**Spec:** [`../../../../mosaic-specs/v0.3.1-boot-token-log-spec.md`](../../../../mosaic-specs/v0.3.1-boot-token-log-spec.md)

---

## File Structure

- `api/src/lib/token.ts` — **modify**: add `formatBootToken(result, baseUrl?): string[]` beside the existing `mintToken`/`MintResult`. Pure, no I/O.
- `api/src/server.ts` — **modify**: after the existing `app.log.info('Mosaic API listening …')` line in `main()`, mint a token and print the formatted block via `console.log`.
- `api/test/token.test.ts` — **modify**: add `formatBootToken` cases to the existing suite.
- `docker-compose.yml`, `docker-compose.prod.yml` — **modify**: add a commented `BASE_URL` example on the `api` service.
- `README.md` — **modify**: note the boot-log path in the "Capability tokens" section.

---

## Task 1: `formatBootToken` pure function

**Files:**
- Modify: `api/src/lib/token.ts` (add export after `mintToken`)
- Test: `api/test/token.test.ts` (add cases to existing suite)

- [ ] **Step 1: Write the failing tests**

The file's existing import line is:

```ts
import { signToken, verifyToken, mintToken, type TokenPayload } from '../src/lib/token.js';
```

Add `formatBootToken` to it:

```ts
import { signToken, verifyToken, mintToken, formatBootToken, type TokenPayload } from '../src/lib/token.js';
```

Then append this new `describe` block at the end of the file:

```ts
describe('formatBootToken', () => {
  const result = mintToken({
    secret: 'test-secret',
    eid: 'remembrance',
    ttlDays: 14,
    baseUrl: 'https://event.example.com',
    now: 1_700_000_000_000,
  });

  it('includes a URL line when baseUrl is set', () => {
    const lines = formatBootToken(result, 'https://event.example.com');
    expect(lines).toHaveLength(4);
    expect(lines[0]).toBe('✓ Token minted');
    expect(lines.some((l) => l.includes(result.token))).toBe(true);
    expect(lines.some((l) => l.includes(result.expiresAt))).toBe(true);
    expect(lines.some((l) => l.includes('URL:') && l.includes(result.url))).toBe(true);
  });

  it('omits the URL line when baseUrl is undefined', () => {
    const lines = formatBootToken(result, undefined);
    expect(lines).toHaveLength(3);
    expect(lines.some((l) => l.includes('URL:'))).toBe(false);
    expect(lines.some((l) => l.includes(result.token))).toBe(true);
    expect(lines.some((l) => l.includes(result.expiresAt))).toBe(true);
  });

  it('logs a token that verifies for the same secret and event', () => {
    const minted = mintToken({ secret: 'test-secret', eid: 'remembrance', ttlDays: 14 });
    const v = verifyToken(minted.token, 'test-secret', 'remembrance');
    expect(v.ok).toBe(true);
  });
});
```

Note: `verifyToken` and `mintToken` are already exported from `token.ts`; only `formatBootToken` is new.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm --prefix api run test -- --run token`
Expected: FAIL — `formatBootToken is not a function` / not exported.

(The `api` test script is bare `vitest`, i.e. watch mode; `-- --run token` runs the token spec once and exits.)

- [ ] **Step 3: Implement `formatBootToken`**

Add to `api/src/lib/token.ts`, immediately after the `mintToken` function:

```ts
export function formatBootToken(result: MintResult, baseUrl?: string): string[] {
  const lines = [
    '✓ Token minted',
    `  Token:   ${result.token}`,
    `  Expires: ${result.expiresAt}`,
  ];
  if (baseUrl) {
    lines.push(`  URL:     ${result.url}`);
  }
  return lines;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm --prefix api run test -- --run token`
Expected: PASS — all `formatBootToken` cases green, existing token cases still green.

- [ ] **Step 5: Typecheck**

Run: `npm --prefix api run typecheck`
Expected: clean, no errors.

- [ ] **Step 6: Commit**

```bash
git add api/src/lib/token.ts api/test/token.test.ts
git commit -m "feat(api): add formatBootToken for boot-time token log

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: Wire boot mint + log into the server

**Files:**
- Modify: `api/src/server.ts` (after the existing "listening" log line in `main()`)

This is a thin wiring change with no new logic, so there is no unit test (consistent with the existing untested "listening" log and seed-skip warnings). Verification is the boot smoke test in Step 3.

- [ ] **Step 1: Add the mint + log block**

In `api/src/server.ts`:

First, extend the existing import of `mintToken`/`requireTokenSecret` etc. The current import is:

```ts
import { requireTokenSecret, makeRequireToken } from './lib/auth.js';
```

`mintToken` and `formatBootToken` come from `./lib/token.js`, which is **not** yet imported in `server.ts`. Add a new import line beside the other `./lib/*` imports:

```ts
import { mintToken, formatBootToken } from './lib/token.js';
```

Then, immediately after the existing line:

```ts
  app.log.info(`Mosaic API listening on http://${HOST}:${PORT}, data=${paths.dataDir}`);
```

add:

```ts
  const baseUrl = process.env.BASE_URL;
  const ttlDays = Number(process.env.TOKEN_TTL_DAYS) || 14;
  const minted = mintToken({ secret: tokenSecret, eid: event.id, ttlDays, baseUrl });
  for (const line of formatBootToken(minted, baseUrl)) console.log(line);
```

`tokenSecret` and `event` are both already in scope in `main()` (resolved near the top). No other changes.

- [ ] **Step 2: Typecheck**

Run: `npm --prefix api run typecheck`
Expected: clean.

- [ ] **Step 3: Boot smoke test — both BASE_URL states**

Use the `start` script (`tsx src/server.ts`, a clean one-shot — not the `dev` watch script).

With `BASE_URL` set (token + expiry + URL line):

Run:
```bash
TOKEN_SECRET=devsecret EVENT_MODE=remembrance BASE_URL=https://event.example.com \
  DATA_DIR=$(mktemp -d) npm --prefix api run start &
```
Wait for boot, then confirm the log shows a 4-line block:
```
✓ Token minted
  Token:   <token>
  Expires: <iso>
  URL:     https://event.example.com/#t=<token>
```
Then kill the process: `kill %1`.

With `BASE_URL` unset (token + expiry only, no URL line):

Run:
```bash
TOKEN_SECRET=devsecret EVENT_MODE=remembrance \
  DATA_DIR=$(mktemp -d) npm --prefix api run start &
```
Confirm the log shows a 3-line block with **no** `URL:` line. Then `kill %1`.

- [ ] **Step 4: Commit**

```bash
git add api/src/server.ts
git commit -m "feat(api): print minted token to stdout on boot

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: Document `BASE_URL` in compose files

**Files:**
- Modify: `docker-compose.yml`
- Modify: `docker-compose.prod.yml`

- [ ] **Step 1: Add commented BASE_URL to `docker-compose.prod.yml`**

In `docker-compose.prod.yml`, under the `api` service `environment:` block, immediately after the commented `# TOKEN_TTL_DAYS: "14"` line (near line 30, before the `EVENT_TITLE` example block), add (6-space indentation):

```yaml
      # Optional: public origin of the app, e.g. https://your-event.example.com
      # When set, the boot log prints the full QR URL (.../#t=<token>) ready to
      # paste into a QR generator. When unset, the boot log prints token +
      # expiry only and you append /#t=<token> to your event host yourself.
      # BASE_URL: "https://your-event.example.com"
```

- [ ] **Step 2: Add the same commented BASE_URL to `docker-compose.yml`**

`docker-compose.yml` ends its `api` `environment:` block with:

```yaml
      TOKEN_SECRET: ${TOKEN_SECRET:-}
      # TOKEN_TTL_DAYS: "14"   # validity window for newly minted tokens
```

Add the same commented `BASE_URL` block immediately after that comment line (same 6-space indentation):

```yaml
      # Optional: public origin of the app, e.g. https://your-event.example.com
      # When set, the boot log prints the full QR URL (.../#t=<token>) ready to
      # paste into a QR generator. When unset, the boot log prints token +
      # expiry only and you append /#t=<token> to your event host yourself.
      # BASE_URL: "https://your-event.example.com"
```

- [ ] **Step 3: Verify compose files still parse**

Run: `docker compose -f docker-compose.prod.yml config -q && docker compose -f docker-compose.yml config -q`
Expected: no output, exit 0 (valid YAML/compose). If `docker compose` is unavailable in the environment, skip with a note and rely on a YAML lint instead.

- [ ] **Step 4: Commit**

```bash
git add docker-compose.yml docker-compose.prod.yml
git commit -m "docs(ops): document optional BASE_URL for boot token log

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: Note the boot-log path in the README

**Files:**
- Modify: `README.md` (the "Capability tokens" section)

- [ ] **Step 1: Read the existing "Capability tokens" section**

Run: `grep -n "Capability tokens\|mint-token\|TOKEN_SECRET\|TOKEN_TTL_DAYS" README.md`
Read that section to match its tone and heading style before editing.

- [ ] **Step 2: Add a short subsection**

Within the "Capability tokens" section of `README.md`, after the `mint-token` CLI explanation, add:

```markdown
### Getting the QR URL without SSH (boot log)

On every boot the API also mints a token and prints it to stdout, so you can
read it from your container log viewer (e.g. Dockhand) without SSH:

\```
✓ Token minted
  Token:   eyJlaWQiOiJyZW1lbWJyYW5jZSIsImV4cCI6...
  Expires: 2026-06-13T10:00:00.000Z
  URL:     https://your-event.example.com/#t=eyJ...
\```

Set `BASE_URL` (the app's public origin) to get the ready-to-paste `URL:`
line. Without it, the log prints the token + expiry only and you append
`/#t=<token>` to your event host yourself. Each restart prints a fresh
token; previously minted tokens (the QR poster, earlier boots) keep working
until their own expiry.
```

(Replace the `\`` fence escapes with real triple backticks when editing — they are escaped here only to nest inside this plan.)

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: document boot-time token log in README

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Final verification

- [ ] **Full test suite**

Run: `npm run test`
Expected: all suites pass, including the new `formatBootToken` cases.

- [ ] **Typecheck**

The only code change is in `api`, and there is no root `typecheck` script.

Run: `npm --prefix api run typecheck`
Expected: clean. (Root `npm run build` also typechecks both packages via `tsc --noEmit` if you want the full check.)

- [ ] **Acceptance checklist (from the spec)**

- `npm run test` green incl. `formatBootToken` cases ✓
- `npm run typecheck` clean ✓
- Boot with `BASE_URL` set → 4-line block; pasting the `URL:` lets you upload via the contribute sheet
- Boot with `BASE_URL` unset → token + expiry only, no `URL:` line; manually opening `<host>/#t=<token>` still uploads
- A token from a prior boot still uploads until its own `exp`
