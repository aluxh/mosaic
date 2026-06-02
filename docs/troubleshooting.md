# Mosaic — Troubleshooting Guide

Common problems operators may encounter and how to resolve them.

---

## App shows the wrong mode (celebration instead of remembrance, or vice versa)

**Symptom:** The app loads but shows the wrong theme, title, or wording for your
event — for example, a memorial is displaying wedding copy.

**Cause:** The SQLite database contains a leftover event row from a previous
deployment or from a mode change after first boot. The app always shows the
first event alphabetically. If both `celebration` and `remembrance` rows exist,
`celebration` wins regardless of your `EVENT_MODE` setting.

**Fix:**

1. Stop the stack (Dockhand UI: stop the stack, or via SSH):
   ```bash
   docker compose -f <your-compose-file>.yml down
   ```

2. Delete the database files (this preserves user uploads in `uploads/`):
   ```bash
   sudo rm /volume1/docker/<event-name>/data/mosaic.db
   sudo rm -f /volume1/docker/<event-name>/data/mosaic.db-wal \
              /volume1/docker/<event-name>/data/mosaic.db-shm
   ```

   If you have no real uploads yet and want a completely clean slate:
   ```bash
   sudo rm -rf /volume1/docker/<event-name>/data/*
   ```

3. Start the stack again:
   ```bash
   docker compose -f <your-compose-file>.yml up -d
   ```

4. Verify — should return exactly one row with the correct mode:
   ```bash
   curl https://<your-domain>/api/events
   ```

**Prevention:** Always stop the stack and wipe the database before changing
`EVENT_MODE` on a deployment that has already run. The safest approach is to
treat each event as a fresh deployment (new data folder, new stack).

---

## App is stuck on "Loading event…"

**Symptom:** The wall loads but stays on the "Loading event…" spinner and never
shows content.

**Possible causes and fixes:**

1. **API container is not running** — Check Dockhand or Container Manager to
   confirm both `api` and `web` containers are running. Restart the stack if
   either has exited.

2. **Wrong `DATA_DIR`** — Confirm `DATA_DIR: /data` is set in the `api`
   container's environment and that the volume mount in your compose file points
   to a folder that exists on the NAS.

3. **Database not yet seeded** — If the API crashed on first boot before it
   could write the database, restart the stack. Check logs:
   ```bash
   docker compose logs api
   ```

4. **Reverse proxy not forwarding `/api/`** — DSM's reverse proxy must route
   all traffic (including `/api/*`) to the container port. Re-check the reverse
   proxy rule; it should proxy to `localhost:<port>` with no path rewriting.

---

## Uploaded photos or messages are gone after a restart

**Symptom:** Content that guests submitted has disappeared after the stack was
restarted or redeployed.

**Cause:** The data volume was not mounted, or it was mounted to a different
path than the previous deployment.

**Fix:**

- Confirm the volume in your compose file maps to a persistent NAS path, e.g.:
  ```yaml
  volumes:
    - /volume1/docker/<event-name>/data:/data
  ```
- Do **not** omit the volume or change the host path between deployments.
- The same path must be used in both `api` (read-write) and `web` (read-only):
  ```yaml
  # api
  - /volume1/docker/<event-name>/data:/data
  # web
  - /volume1/docker/<event-name>/data:/var/lib/mosaic-data:ro
  ```

---

## `EVENT_MODE` warning in API logs

**Symptom:** The API logs show:
```
EVENT_MODE is not set; defaulting to "celebration".
```
or:
```
EVENT_MODE "xyz" is invalid; defaulting to "celebration".
```

**Fix:** Set `EVENT_MODE` to exactly `celebration` or `remembrance` (lowercase,
no quotes) in the `api` container's environment block:

```yaml
environment:
  EVENT_MODE: remembrance
```

Restart the stack after changing it. Also see [App shows the wrong mode](#app-shows-the-wrong-mode-celebration-instead-of-remembrance-or-vice-versa) above if
the app is already running with stale data.

---

## Container fails to start — port already in use

**Symptom:** The `web` container exits immediately with an error like
`port is already allocated` or `address already in use`.

**Fix:** Choose a different host port in your compose file:

```yaml
ports:
  - "34567:80"   # change the left number to any free port
```

Check what ports are in use:
```bash
sudo netstat -tlnp | grep <port>
```

If you are running two events on the same NAS, each stack must use a different
host port. Map each to its own subdomain via DSM's reverse proxy.

---

## Seed photos not showing up

**Symptom:** You placed photos in the seeds folder but they don't appear on the
wall.

**Expected folder structure:**
```
/volume1/docker/<event-name>/data/seeds/<EVENT_MODE>/
```

For example, for a remembrance event:
```
/volume1/docker/belovedgm/data/seeds/remembrance/photo1.jpg
```

**Fix:** Confirm the folder path matches your `EVENT_MODE` exactly. After
placing files, restart the stack so the seed indexer re-scans:
```bash
docker compose restart api
```

Only JPEG/JPG/PNG/HEIC files are indexed. Files in subdirectories are ignored. HEIC files are transcoded to JPEG on ingest.
