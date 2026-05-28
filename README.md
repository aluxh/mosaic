# Mosaic

A self-hosted **Shared Memory Wall** for memorials and celebrations. Guests
scan a QR code → see the live slideshow on a TV display → tap "Add to wall"
to upload a photo or leave a written memory.

Designed to run on a Synology NAS via Docker.

## Status

**v0.1 — Foundation** is shipped. The roadmap and feature specs live in a
private sibling repo (`aluxh/mosaic-specs`).

## Ground rules

This project follows the rules in [`CLAUDE.md`](CLAUDE.md):
spec-driven, TDD, simplicity-first, surgical changes. Read it before contributing.

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
git tag v0.1.0
git push --tags
```

GitHub Actions builds and pushes `mosaic-api` and `mosaic-web` to GHCR (takes
~5 minutes). Then in Dockhand, click **Re-pull & redeploy** on the mosaic
stack. SQLite data and uploads persist across redeploys.

After the first push, go to <https://github.com/users/aluxh/packages> and set
both `mosaic-api` and `mosaic-web` packages to **Public** and link them to
this repository.

### Secrets policy

All secrets — admin password, HMAC signing keys, JWT secrets (none in v0.1;
several in v0.2+) — **must** be passed via the `environment:` block in
`docker-compose.prod.yml` on the NAS. Never bake secrets into a Dockerfile,
never commit a `.env` file, never hardcode them in source. `.dockerignore`
already excludes `.env*`; do not remove that line.
