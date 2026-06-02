# Mosaic

A self-hosted **Shared Memory Wall** for memorials and celebrations. Guests
scan a QR code → see the live slideshow on a TV display → tap "Add to wall"
to upload a photo or leave a written memory.

Designed to run on a Synology NAS via Docker.

## Layout

```
web/        # React + Vite frontend (TypeScript, Tailwind, Framer Motion)
api/        # Fastify backend (TypeScript, better-sqlite3, sharp)
data/       # runtime data — SQLite db + photos (gitignored, mounted into Docker)
```

## Local development

```bash
npm run install:all     # install root + web + api dependencies
npm run dev             # starts Vite (5173) + Fastify (3000) concurrently
npm test                # runs both test suites
```

## Operator shortcuts

These work on any keyboard connected to the TV (or via SSH with the browser open):

| Key | Action |
|---|---|
| `Space` | Pause / resume auto-advance |
| `ArrowLeft` | Jump to previous slide (wraps) |
| `ArrowRight` | Jump to next slide (wraps) |
| `c` | Open "Add to the wall" contribute sheet when a token is present |
| `Escape` | Close contribute sheet |

On-screen: move the mouse to reveal `[‹] [pause] [›]` buttons at the bottom-right.
The nav buttons are hidden during unattended playback and fade in on mouse activity
or when the wall is paused.

## Deploying to Synology

Pre-built images are published to GHCR on every version tag. No build
step needed on the NAS.

**One deployment = one event.** Each event (wedding, memorial, etc.) gets
its own Docker stack and its own data folder. To host two events
simultaneously, deploy two stacks.

### One-time NAS bootstrap (SSH in once)

Choose your event mode — `celebration` or `remembrance` — then create its
data folder:

```bash
# Replace "mosaic" with your event name and "celebration" with your mode.
sudo mkdir -p /volume1/docker/mosaic/data/seeds/celebration
sudo mkdir -p /volume1/docker/mosaic/data/uploads/celebration
sudo mkdir -p /volume1/docker/mosaic/data/variants/celebration
```

Drop seed photos into `seeds/celebration/` (or `seeds/remembrance/`).

### Deploy via Dockhand

1. Open Dockhand in your browser.
2. Create a new Stack named after your event (e.g. `mosaic`, `graduation2026`).
3. Paste the contents of `docker-compose.prod.yml` into the compose editor.
4. **Set `EVENT_MODE`** in the compose editor to `celebration` or `remembrance`.
5. Update the bind-mount path to match your data folder
   (e.g. `/volume1/docker/graduation2026/data:/data`).
6. Click **Deploy** — Dockhand pulls the images from GHCR and starts both
   containers.
7. The slideshow is reachable at `http://<nas-ip>:8080/`.

#### Customize the event copy

Without any extra config, the slideshow shows the built-in placeholder text
("Theodore James Halloway" etc.). Set any of these env vars on the `api`
container to override them — no code change or image rebuild needed:

| Variable | What it changes |
|---|---|
| `EVENT_TITLE` | Name on the title card (e.g. `"Grace Mei Wong"`) |
| `EVENT_EYEBROW` | Small label above the name (e.g. `"Celebrating the life of"`) |
| `EVENT_DATELINE` | Dates below the name (e.g. `"1925 — 2026"`) |
| `EVENT_PLACE` | Venue / context line on the title card |
| `EVENT_INVITATION` | Invitation text at the bottom of the title card |
| `EVENT_BRAND_SUB` | Subtitle under "Mosaic" in the top-left chrome (e.g. `"In remembrance · Grace"`) |
| `EVENT_SHORT_CODE` | Short code shown on the contribute button (e.g. `"GM26"`) |

Unset or empty vars fall back to the seed values — nothing breaks if you
leave them out. All commented-out examples are in `docker-compose.prod.yml`.

Redeploying with new values updates the event row in the database automatically
(the boot path upserts on every start).

For HTTPS, add a reverse proxy rule in DSM Control Panel → Login Portal →
Reverse Proxy: source `your-event.yourdomain.com:443` (HTTPS, Let's Encrypt) →
destination `localhost:8080` (HTTP).

### Deploying another event

Copy `docker-compose.prod.yml` into a new Dockhand stack. Change:
- `EVENT_MODE` — to the new event's mode
- The bind-mount path — to a new data folder, e.g. `/volume1/docker/belovedgm/data`
- The host port — to avoid conflict, e.g. `8081:80`

Point a second subdomain or custom domain at the new port via DSM reverse proxy.
Each event has its own database and photos — they are fully independent.

### Releasing a new version

```bash
git tag -a vX.Y.Z -m "vX.Y.Z"
git push origin vX.Y.Z
```

GitHub Actions builds and pushes `mosaic-api` and `mosaic-web` to GHCR (takes
~5 minutes). Then in Dockhand, click **Re-pull & redeploy** on the mosaic
stack. SQLite data and uploads persist across redeploys.

After the first push, go to <https://github.com/users/aluxh/packages> and set
both `mosaic-api` and `mosaic-web` packages to **Public** and link them to
this repository.

### Capability tokens

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

### Admin curation

The `/admin` page lets you hide, show, or delete content from the wall in
real time without touching the database directly.

**What you can curate:**

- **Photos tab** — hide/show guest and seed photos; delete photos permanently
- **Messages tab** — hide/show or delete standalone text messages (messages
  without a photo); hiding a photo automatically suppresses its caption from
  appearing as a text slide

**Mint an admin token:**

```bash
docker compose exec api npm run mint-token -- --admin https://your-event-host
```

The `--admin` flag produces a URL of the form
`https://your-event-host/admin#t=<token>`. Open that URL in a browser — no
login form, just paste or bookmark the link. Keep it private; anyone with it
can modify the wall.

The admin token uses the same `TOKEN_SECRET` and `TOKEN_TTL_DAYS` settings as
the guest token. Minting a new admin token does not invalidate the old one
until it expires naturally (or you rotate `TOKEN_SECRET`).

### Getting the QR URL without SSH (boot log)

On every boot the API also mints a token and prints it to stdout, so you can
read it from your container log viewer (e.g. Dockhand) without SSH:

```
✓ Token minted
  Token:   eyJlaWQiOiJyZW1lbWJyYW5jZSIsImV4cCI6...
  Expires: 2026-06-13T10:00:00.000Z
  URL:     https://your-event.example.com/#t=eyJ...
```

Set `BASE_URL` (the app's public origin) to get the ready-to-paste `URL:`
line. Without it, the log prints the token + expiry only and you append
`/#t=<token>` to your event host yourself. Each restart prints a fresh
token; previously minted tokens (the QR poster, earlier boots) keep working
until their own expiry.

### Thumbnail variants

The API writes downscaled `1024w` and `320w` variants under
`data/variants/<event-id>/` for uploads and seed photos. Existing photos are
backfilled on API boot, so no manual migration is needed. Keep
`data/variants/` in the same mounted data folder as `seeds/`, `uploads/`, and
`mosaic.db`.

### Upload safety & rate limiting

The API validates upload paths before writing files and applies per-IP rate
limiting. The `TRUST_PROXY` env var on the `api` service controls how the real
client IP is resolved behind a reverse proxy. The default covers the standard
Synology DSM reverse proxy setup — leave `TRUST_PROXY` unset unless you're
deploying behind a proxy that forwards from a public IP (see
`docker-compose.prod.yml` for examples).

**HSTS:** Set `Strict-Transport-Security` at your upstream TLS-terminating
proxy (Synology, Caddy, AWS ALB, etc.), not in the Mosaic container.

### Secrets policy

All secrets — admin password, HMAC signing keys, JWT secrets — **must** be
passed via the `environment:` block in
`docker-compose.prod.yml` on the NAS. Never bake secrets into a Dockerfile,
never commit a `.env` file, never hardcode them in source. `.dockerignore`
already excludes `.env*`; do not remove that line.
