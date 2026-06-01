import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Fastify, { type FastifyInstance } from 'fastify';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import sharp from 'sharp';
import { openDatabase, type DB } from '../src/db/index.js';
import { applySchemaFromString } from '../src/db/migrate.js';
import { upsertEvent } from '../src/db/queries.js';
import { registerEventRoutes } from '../src/routes/events.js';
import { registerMessageRoutes } from '../src/routes/messages.js';
import { registerPhotoRoutes } from '../src/routes/photos.js';
import { registerStreamRoutes } from '../src/routes/stream.js';
import { makeStoragePaths, type StoragePaths } from '../src/lib/storage.js';
import { makeRequireToken } from '../src/lib/auth.js';
import { signToken } from '../src/lib/token.js';
import { createLiveUpdateBus } from '../src/lib/liveUpdates.js';

const TEST_SECRET = 'stream-test-secret';
const validAuth = (eid = 'remembrance'): string =>
  `Bearer ${signToken({ eid, exp: Math.floor(Date.now() / 1000) + 3600 }, TEST_SECRET)}`;

const migrationsDir = path.resolve(__dirname, '..', 'migrations');
const SCHEMA = fs
  .readdirSync(migrationsDir)
  .filter((f) => f.endsWith('.sql'))
  .sort()
  .map((f) => fs.readFileSync(path.join(migrationsDir, f), 'utf8'))
  .join('\n');

let tmpDir: string;
let paths: StoragePaths;
let db: DB;
let app: FastifyInstance;
let minimalPng: Buffer;

beforeAll(async () => {
  minimalPng = await sharp({
    create: { width: 1, height: 1, channels: 3 as const, background: 'red' },
  }).png().toBuffer();
});

async function buildApp() {
  const liveUpdates = createLiveUpdateBus();
  app = Fastify();
  await app.register(multipart, { limits: { fileSize: 10 * 1024 * 1024 } });
  await app.register(rateLimit, { max: 100, timeWindow: 60_000 });
  const requireToken = makeRequireToken(TEST_SECRET);
  registerEventRoutes(app, db);
  registerStreamRoutes(app, db, liveUpdates);
  registerMessageRoutes(app, db, requireToken, liveUpdates);
  registerPhotoRoutes(app, db, paths, requireToken, liveUpdates);
  await app.ready();
}

beforeEach(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mosaic-stream-'));
  paths = makeStoragePaths(tmpDir);
  fs.mkdirSync(paths.seedsDir, { recursive: true });
  fs.mkdirSync(paths.uploadsDir, { recursive: true });
  db = openDatabase(':memory:');
  applySchemaFromString(db, SCHEMA);
  upsertEvent(db, {
    id: 'remembrance',
    mode: 'remembrance',
    eyebrow: 'In memory',
    title: 'Theodore',
    dateline: 'date',
    place: 'place',
    invitation: 'invite',
    brand_sub: 'sub',
    short_code: 'X1',
  });
  await buildApp();
});

afterEach(async () => {
  await app.close();
  db.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

async function openStream(eventId = 'remembrance') {
  const controller = new AbortController();
  const res = await app.inject({
    method: 'GET',
    url: `/api/events/${eventId}/stream`,
    payloadAsStream: true,
    signal: controller.signal,
  });
  return {
    res,
    chunks: res.stream()[Symbol.asyncIterator](),
    close: () => controller.abort(),
  };
}

async function readUntil(chunks: AsyncIterator<Buffer>, expected: string) {
  let text = '';
  const deadline = Date.now() + 1000;
  while (!text.includes(expected)) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new Error(`timed out waiting for ${expected}; got ${text}`);
    const chunk = await Promise.race([
      chunks.next(),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('read timeout')), remaining)),
    ]);
    if (chunk.done) break;
    text += chunk.value.toString('utf8');
  }
  return text;
}

async function uploadWithFields(fields: Record<string, string> = {}) {
  const boundary = '----stream-boundary';
  const parts: Buffer[] = [
    Buffer.from(`--${boundary}\r\n`),
    Buffer.from(
      'Content-Disposition: form-data; name="file"; filename="p.png"\r\nContent-Type: image/png\r\n\r\n',
    ),
    minimalPng,
    Buffer.from('\r\n'),
  ];
  for (const [name, value] of Object.entries(fields)) {
    parts.push(
      Buffer.from(`--${boundary}\r\n`),
      Buffer.from(`Content-Disposition: form-data; name="${name}"\r\n\r\n`),
      Buffer.from(value),
      Buffer.from('\r\n'),
    );
  }
  parts.push(Buffer.from(`--${boundary}--\r\n`));
  return app.inject({
    method: 'POST',
    url: '/api/events/remembrance/photos',
    headers: {
      'content-type': `multipart/form-data; boundary=${boundary}`,
      authorization: validAuth(),
    },
    payload: Buffer.concat(parts),
  });
}

describe('GET /api/events/:id/stream', () => {
  it('404s for an unknown event', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/events/nope/stream' });
    expect(res.statusCode).toBe(404);
  });

  it('responds with SSE headers and an initial ready event', async () => {
    const stream = await openStream();
    try {
      expect(stream.res.statusCode).toBe(200);
      expect(String(stream.res.headers['content-type'])).toContain('text/event-stream');
      expect(stream.res.headers['cache-control']).toBe('no-cache, no-transform');
      expect(stream.res.headers['connection']).toBe('keep-alive');
      expect(await readUntil(stream.chunks, 'event: ready')).toContain('data: {}');
    } finally {
      stream.close();
    }
  });

  it('is public while write routes still require capability tokens', async () => {
    const stream = await openStream();
    try {
      expect(stream.res.statusCode).toBe(200);
    } finally {
      stream.close();
    }

    const write = await app.inject({
      method: 'POST',
      url: '/api/events/remembrance/messages',
      payload: { text: 'hello' },
    });
    expect(write.statusCode).toBe(401);
  });

  it('emits message_created after a text-only message write', async () => {
    const stream = await openStream();
    try {
      await readUntil(stream.chunks, 'event: ready');
      const res = await app.inject({
        method: 'POST',
        url: '/api/events/remembrance/messages',
        headers: { authorization: validAuth() },
        payload: { text: 'hello' },
      });
      expect(res.statusCode).toBe(201);
      const text = await readUntil(stream.chunks, '"type":"message_created"');
      expect(text).toContain('event: mosaic-update');
      expect(text).toContain('"eventId":"remembrance"');
    } finally {
      stream.close();
    }
  });

  it('emits photo_created after a photo upload', async () => {
    const stream = await openStream();
    try {
      await readUntil(stream.chunks, 'event: ready');
      const res = await uploadWithFields();
      expect(res.statusCode).toBe(201);
      const text = await readUntil(stream.chunks, '"type":"photo_created"');
      expect(text).toContain('event: mosaic-update');
    } finally {
      stream.close();
    }
  });

  it('emits photo_created and message_created for an upload with a linked message', async () => {
    const stream = await openStream();
    try {
      await readUntil(stream.chunks, 'event: ready');
      const res = await uploadWithFields({ message: 'A note' });
      expect(res.statusCode).toBe(201);
      let text = await readUntil(stream.chunks, '"type":"photo_created"');
      if (!text.includes('"type":"message_created"')) {
        text += await readUntil(stream.chunks, '"type":"message_created"');
      }
      expect(text).toContain('"type":"photo_created"');
      expect(text).toContain('"type":"message_created"');
    } finally {
      stream.close();
    }
  });
});
