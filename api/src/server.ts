import fs from 'node:fs';
import path from 'node:path';
import Fastify from 'fastify';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import { openDatabase } from './db/index.js';
import { migrate } from './db/migrate.js';
import { SEED_EVENTS, resolveEventMode, applyEventOverrides } from './lib/seedEvents.js';
import { upsertEvent } from './db/queries.js';
import { indexSeedsForEvent } from './lib/seedIndex.js';
import { backfillVariants } from './lib/backfillVariants.js';
import { reconcileMissingPhotos } from './lib/reconcilePhotos.js';
import { makeStoragePaths } from './lib/storage.js';
import { requireTokenSecret, makeRequireToken, makeRequireAdmin } from './lib/auth.js';
import { mintToken, formatBootToken } from './lib/token.js';
import { parseTrustProxy } from './lib/trustProxy.js';
import { registerEventRoutes } from './routes/events.js';
import { registerMessageRoutes } from './routes/messages.js';
import { registerPhotoRoutes } from './routes/photos.js';
import { registerStreamRoutes } from './routes/stream.js';
import { registerAdminRoutes } from './routes/admin.js';
import { createLiveUpdateBus } from './lib/liveUpdates.js';

const DATA_DIR = process.env.DATA_DIR ?? path.resolve(process.cwd(), '..', 'data');
const PORT = Number(process.env.PORT ?? 3000);
const HOST = process.env.HOST ?? '0.0.0.0';

async function main() {
  const tokenSecret = requireTokenSecret(process.env);
  const paths = makeStoragePaths(DATA_DIR);
  fs.mkdirSync(paths.dataDir, { recursive: true });
  fs.mkdirSync(paths.seedsDir, { recursive: true });
  fs.mkdirSync(paths.uploadsDir, { recursive: true });
  fs.mkdirSync(paths.variantsDir, { recursive: true });

  const db = openDatabase(paths.dbFile);
  migrate(db);
  const mode = resolveEventMode();
  const event = applyEventOverrides(SEED_EVENTS[mode]);
  upsertEvent(db, event);
  fs.mkdirSync(path.join(paths.seedsDir, event.id), { recursive: true });
  fs.mkdirSync(path.join(paths.uploadsDir, event.id), { recursive: true });
  const reconcileResult = reconcileMissingPhotos(db, paths, event.id);
  if (reconcileResult.removed > 0) {
    console.warn(`[reconcile] removed ${reconcileResult.removed} stale photo rows for ${event.id}`);
  }
  const seedResult = await indexSeedsForEvent(db, paths, event.id);
  for (const { filename, reason } of seedResult.skipped_reasons) {
    console.warn(`[seed] skipped ${filename}: ${reason}`);
  }
  await backfillVariants(db, paths, event.id);

  const app = Fastify({
    logger: { level: 'info' },
    trustProxy: parseTrustProxy(process.env.TRUST_PROXY),
  });
  await app.register(multipart, {
    limits: { fileSize: 10 * 1024 * 1024 },
  });
  await app.register(rateLimit, {
    max: 120,
    timeWindow: 60_000,
  });
  await app.register(fastifyStatic, {
    root: paths.dataDir,
    prefix: '/data/',
    decorateReply: false,
  });

  const requireToken = makeRequireToken(tokenSecret);
  const liveUpdates = createLiveUpdateBus();
  registerEventRoutes(app, db);
  registerStreamRoutes(app, db, liveUpdates);
  registerMessageRoutes(app, db, requireToken, liveUpdates);
  registerPhotoRoutes(app, db, paths, requireToken, liveUpdates);
  registerAdminRoutes(app, db, paths, makeRequireAdmin(tokenSecret), liveUpdates);

  app.get('/health', async () => ({ ok: true }));

  await app.listen({ port: PORT, host: HOST });
  app.log.info(`Mosaic API listening on http://${HOST}:${PORT}, data=${paths.dataDir}`);

  const baseUrl = process.env.BASE_URL;
  const ttlDays = Number(process.env.TOKEN_TTL_DAYS) || 14;
  const minted = mintToken({ secret: tokenSecret, eid: event.id, ttlDays, baseUrl });
  for (const line of formatBootToken(minted, baseUrl)) console.log(line);

  const mintedAdmin = mintToken({ secret: tokenSecret, eid: event.id, ttlDays, baseUrl, role: 'admin' });
  console.log('✓ Admin token minted');
  for (const line of formatBootToken(mintedAdmin, baseUrl)) console.log(line);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
