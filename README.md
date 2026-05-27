# Mosaic

A self-hosted **Shared Memory Wall** for memorials and celebrations. Guests
scan a QR code → see the live slideshow on a TV display → tap "Add to wall"
to upload a photo or leave a written memory.

Designed to run on a Synology NAS via Docker.

## Status

**v0.1 — Foundation** is in progress. See [`spec/roadmap.md`](spec/roadmap.md)
for the phase plan and [`spec/v0.1-foundation-spec.md`](spec/v0.1-foundation-spec.md)
for the current spec.

## Ground rules

This project follows the rules in [`CLAUDE.md`](CLAUDE.md):
spec-driven, TDD, simplicity-first, surgical changes. Read it before contributing.

## Layout

```
web/        # React + Vite frontend (TypeScript, Tailwind, Framer Motion)
api/        # Fastify backend (TypeScript, better-sqlite3, sharp)
data/       # runtime data — SQLite db + photos (gitignored, mounted into Docker)
spec/       # roadmap + per-feature specs
```

## Local development

```bash
npm run install:all     # install root + web + api dependencies
npm run dev             # starts Vite (5173) + Fastify (3000) concurrently
npm test                # runs both test suites
```

## Production (Synology)

```bash
docker compose up --build -d
```

Bind-mount `./data` to your Synology volume (e.g. `/volume1/docker/mosaic/data`)
in `docker-compose.yml`. Drop seed photos into `data/seeds/<event-id>/`.
