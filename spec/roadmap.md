# Mosaic — Roadmap

Mosaic is a self-hosted "Shared Memory Wall" web app. Primary use case:
memorial / remembrance services; secondary: celebrations (weddings).

Guests scan a QR code → land on a fullscreen auto-advancing slideshow → tap
"Add to wall" to upload a photo or leave a written memory. The display runs
on a TV; guests interact from their phones.

Target deployment: **Synology NAS via Docker / Container Manager**.

This roadmap captures the phase plan. Each phase has its own detailed spec
in `spec/<phase-name>-spec.md` and is shippable on its own.

---

## v0.1 — Foundation: working slideshow on Synology

**Status:** Code complete — deployment pending
**Specs:**
- [`v0.1-foundation-spec.md`](v0.1-foundation-spec.md) — app build
- [`v0.1-deploy-spec.md`](v0.1-deploy-spec.md) — GHCR + Dockhand on Synology

**Goal:** A guest opens the URL on their phone, sees the slideshow on the TV
display, can upload a photo via the contribute sheet, and the photo appears
in the next slideshow rotation. Runs in Docker on Synology. No auth.

**Deliverables:**
- Vite/React/TS frontend matching the prototype's visual design (all 7 slide
  templates, both modes, chrome, contribute sheet, ticker)
- Fastify/TS backend with read APIs for photos/messages and write APIs for
  uploads/messages
- SQLite persistence
- Seeds folder auto-indexed on startup
- Docker compose with `web` (nginx) + `api` (node) services + shared volume
- Vitest test suite covering pure logic and component behavior

**Out of scope:** auth, thumbnail pipeline, EXIF stripping, multi-event
support, host dashboard, real-time push.

---

## v0.2 — Production hardening

**Status:** Planned
**Spec:** TBD

- QR-code capability tokens (HMAC-signed); `@fastify/jwt` for verification
- Upload validation: size cap (10MB), MIME allowlist, EXIF strip
- Sharp thumbnail pipeline: original + 1024w + 320w variants on upload;
  slideshow lazily loads the right variant per slide context
- Rate limiting (per IP and per token)
- CSP, CORS, security headers
- SSE endpoint for live updates (replaces polling)
- Token rotation CLI (`npm run rotate-token`)

---

## v0.3 — Multi-event + lightweight moderation

**Status:** Planned
**Spec:** TBD

- Multiple events in one instance (event slug in URL)
- Host login (single shared admin password via env var; not multi-user)
- Moderation UI: list contributions, hide/restore, delete
- Event CRUD: create event with name/dateline/mode/seed-folder
- QR-code generator UI
