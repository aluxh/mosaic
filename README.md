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

### One-time NAS bootstrap (SSH in once)

```bash
sudo mkdir -p /volume1/docker/mosaic/data/seeds/{remembrance,celebration}
sudo mkdir -p /volume1/docker/mosaic/data/uploads/{remembrance,celebration}
```

Drop seed photos into `seeds/remembrance/` or `seeds/celebration/`.

### Deploy via Dockhand

1. Open Dockhand in your browser.
2. Create a new Stack named `mosaic`.
3. Paste the contents of `docker-compose.prod.yml` into the compose editor.
4. Click **Deploy** — Dockhand pulls the images from GHCR and starts both
   containers.
5. The slideshow is reachable at `http://<nas-ip>:8080/`.

For HTTPS, add a reverse proxy rule in DSM Control Panel → Login Portal →
Reverse Proxy: source `mosaic.yourdomain.com:443` (HTTPS, Let's Encrypt) →
destination `localhost:8080` (HTTP).

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
