import fs from 'node:fs';
import path from 'node:path';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import { openDatabase } from './db/index.js';
import { migrate } from './db/migrate.js';
import { SEED_EVENTS, resolveEventMode } from './lib/seedEvents.js';
import { upsertEvent } from './db/queries.js';
import { indexSeedsForEvent } from './lib/seedIndex.js';
import { makeStoragePaths } from './lib/storage.js';
import { registerEventRoutes } from './routes/events.js';
import { registerMessageRoutes } from './routes/messages.js';
import { registerPhotoRoutes } from './routes/photos.js';

const DATA_DIR = process.env.DATA_DIR ?? path.resolve(process.cwd(), '..', 'data');
const PORT = Number(process.env.PORT ?? 3000);
const HOST = process.env.HOST ?? '0.0.0.0';

async function main() {
  const paths = makeStoragePaths(DATA_DIR);
  fs.mkdirSync(paths.dataDir, { recursive: true });
  fs.mkdirSync(paths.seedsDir, { recursive: true });
  fs.mkdirSync(paths.uploadsDir, { recursive: true });

  const db = openDatabase(paths.dbFile);
  migrate(db);
  const mode = resolveEventMode();
  const event = SEED_EVENTS[mode];
  upsertEvent(db, event);
  fs.mkdirSync(path.join(paths.seedsDir, event.id), { recursive: true });
  fs.mkdirSync(path.join(paths.uploadsDir, event.id), { recursive: true });
  indexSeedsForEvent(db, paths, event.id);

  const app = Fastify({ logger: { level: 'info' } });
  await app.register(cors, { origin: true });
  await app.register(multipart, {
    limits: { fileSize: 10 * 1024 * 1024 },
  });
  await app.register(fastifyStatic, {
    root: paths.dataDir,
    prefix: '/data/',
    decorateReply: false,
  });

  registerEventRoutes(app, db);
  registerMessageRoutes(app, db);
  registerPhotoRoutes(app, db, paths);

  app.get('/health', async () => ({ ok: true }));

  await app.listen({ port: PORT, host: HOST });
  app.log.info(`Mosaic API listening on http://${HOST}:${PORT}, data=${paths.dataDir}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
