# Deploying Mosaic to Synology NAS

This guide walks through deploying a Mosaic event on a Synology NAS using
Dockhand and DSM's built-in reverse proxy.

**One deployment = one event.** Each event (wedding, memorial, etc.) is its
own Docker stack with its own data folder. To run two events simultaneously,
follow this guide twice with different names and ports.

---

## Prerequisites

- Synology NAS with Docker / Container Manager installed
- [Dockhand](https://dockhand.pro/) running on the NAS
- DSM access for reverse proxy configuration
- SSH access to the NAS (needed once for folder setup)

---

## Step 1 — Create the data folder (SSH, once per event)

SSH into the NAS and create the folder structure for your event.

Replace `mosaic` with a short name for your event (e.g. `graduation2026`,
`belovedgm`) and `celebration` with your event mode.

```bash
# celebration = weddings, graduations, birthdays
# remembrance = memorials, funerals
sudo mkdir -p /volume1/docker/mosaic/data/seeds/celebration
sudo mkdir -p /volume1/docker/mosaic/data/uploads/celebration
```

Then drop your seed photos (the host's own photos) into the seeds folder:

```bash
# Copy photos from your Mac/PC to the NAS
scp ~/Desktop/event-photos/*.jpg admin@<nas-ip>:/volume1/docker/mosaic/data/seeds/celebration/
```

---

## Step 2 — Deploy via Dockhand

1. Open Dockhand in your browser (usually `http://<nas-ip>:3001`).
2. Click **New Stack** and name it after your event (e.g. `mosaic`).
3. Paste the contents of `docker-compose.prod.yml` from this repo into the
   compose editor.
4. Make two edits in the editor:

   **a. Set your event mode** — find this line and change the value:
   ```yaml
   EVENT_MODE: celebration   # change to remembrance for a memorial
   ```

   **b. Set your data path** — find the volumes block and update the host path:
   ```yaml
   volumes:
     - /volume1/docker/mosaic/data:/data        # ← update "mosaic" if needed
   ```
   and for the web service:
   ```yaml
   volumes:
     - /volume1/docker/mosaic/data:/var/lib/mosaic-data:ro   # ← same path
   ```

5. Click **Deploy**. Dockhand pulls both images from GHCR and starts the
   containers. Watch the logs — both containers should reach a healthy state
   within ~30 seconds.

6. Test it: open `http://<nas-ip>:8080/` in a browser. You should see the
   slideshow.

---

## Step 3 — Set up HTTPS with a custom domain (DSM Reverse Proxy)

This maps a clean URL (`your-event.yourdomain.com`) to the running stack
and handles HTTPS automatically via Let's Encrypt.

1. In DSM, go to **Control Panel → Login Portal → Advanced → Reverse Proxy**.
2. Click **Create**.
3. Fill in the form:

   | Field | Value |
   |---|---|
   | **Description** | `mosaic` (or your event name) |
   | **Source — Protocol** | `HTTPS` |
   | **Source — Hostname** | `your-event.yourdomain.com` |
   | **Source — Port** | `443` |
   | **Destination — Protocol** | `HTTP` |
   | **Destination — Hostname** | `localhost` |
   | **Destination — Port** | `8080` |

4. Click **Save**.
5. DSM will prompt to create a Let's Encrypt certificate for the hostname.
   Follow the prompts — it takes ~30 seconds.

Your slideshow is now live at `https://your-event.yourdomain.com`.

> **DNS prerequisite:** the hostname you use must point at your NAS's public
> IP before Let's Encrypt will issue the certificate. If you're using
> Synology DDNS (e.g. `*.synology.me`), you need to add the subdomain as a
> CNAME/A record in your DNS provider, or use a DDNS hostname that already
> resolves to the NAS.

---

## Step 4 — Share the QR code

The contribute URL shown in the bottom-left of the slideshow is:
```
https://your-event.yourdomain.com
```

Generate a QR code for this URL (any free QR generator works) and print or
display it at the venue. Guests scan it on their phones to open the
contribute sheet.

---

## Step 5 — Get the admin curation link

The `/admin` page lets you hide, show, or delete photos and messages from the
wall in real time. Mint a private admin link:

```bash
docker compose exec api npm run mint-token -- --admin https://your-event.yourdomain.com
```

The output looks like:
```
eyJlaWQiOiJyZW1lbWJyYW5jZSIsImV4cCI6...
Expires: 2026-06-16T10:00:00.000Z
https://your-event.yourdomain.com/admin#t=eyJ...
```

Open the printed URL in a browser. The **Photos** tab lets you hide/show/delete
guest and seed photos. The **Messages** tab lists standalone text messages
(without a photo) so you can hide or remove them. Hiding a photo automatically
suppresses its caption on the wall too.

Keep this link private — anyone who has it can modify the wall. If you need to
revoke access, rotate `TOKEN_SECRET` and redeploy.

---

## Updating to a new version

When a new Mosaic version is released:

1. In Dockhand, find your stack and click **Re-pull & Redeploy**.
2. Dockhand pulls the new `:latest` images and restarts the containers.
3. Your SQLite database and uploaded photos are untouched — they live on the
   bind-mounted volume, not inside the container.

To pin to a specific version instead of `:latest`, edit the image tags in
the compose editor before deploying:
```yaml
image: ghcr.io/aluxh/mosaic-api:0.1.1
image: ghcr.io/aluxh/mosaic-web:0.1.1
```

---

## Adding seed photos without redeploying

Drop new JPG/PNG files into the seeds folder on the NAS:

```bash
scp new-photo.jpg admin@<nas-ip>:/volume1/docker/mosaic/data/seeds/celebration/
```

Then restart just the API container in Dockhand (not a full redeploy — just
stop and start the `api` service). The seed indexer runs at boot and picks
up the new files.

---

## Deploying a second event

Follow this guide again from Step 1 with:
- A different event folder name: `/volume1/docker/graduation2026/data/`
- A different stack name in Dockhand: `graduation2026`
- A different host port in the compose file: `8081:80`
- A different `EVENT_MODE` value
- A different reverse proxy hostname

The two stacks are fully independent — separate databases, separate uploads,
separate URLs.

---

## Rate limiting and trusted-proxy configuration

Mosaic rate-limits requests per client IP. The `TRUST_PROXY` env var on the
`api` service controls how the real client IP is resolved behind the reverse
proxy.

**For standard Synology deploys you do not need to set `TRUST_PROXY`.** The
default covers the DSM reverse proxy → Docker bridge chain. Only set it if
you're placing an additional proxy in front that forwards from a public IP —
see the examples in `docker-compose.prod.yml`.

---

## Troubleshooting

**Slideshow shows "Loading event…" forever**
- Check the API container logs in Dockhand. Look for a warning about
  `EVENT_MODE` — if it's misconfigured the app still starts in celebration
  mode but may not match your seeds folder.
- Confirm the bind-mount path in the compose file matches what you created
  in Step 1.

**Seed photos not appearing**
- Confirm files are in the correct subfolder:
  `/volume1/docker/<event>/data/seeds/<EVENT_MODE>/`
- Restart the API container (not the web container) so the seed indexer reruns.
- Check the API logs for lines like `Indexed N seed photos`.

**HTTPS certificate fails**
- Verify the hostname resolves to your NAS's public IP with `dig your-event.yourdomain.com`.
- Synology DDNS hostnames (`.synology.me`) require each subdomain to be
  manually configured in your DNS provider or via DDNS registration.

**Port conflict on 8080**
- Change the host port in the compose file: `8082:80` (or any unused port).
- Update the DSM reverse proxy destination port to match.
