import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Fastify, { type FastifyInstance } from 'fastify';
import multipart from '@fastify/multipart';
import sharp from 'sharp';
import { openDatabase, type DB } from '../src/db/index.js';
import { applySchemaFromString } from '../src/db/migrate.js';
import { upsertEvent } from '../src/db/queries.js';
import { registerEventRoutes } from '../src/routes/events.js';
import { registerMessageRoutes } from '../src/routes/messages.js';
import { registerPhotoRoutes } from '../src/routes/photos.js';
import { makeStoragePaths, type StoragePaths } from '../src/lib/storage.js';
import { indexSeedsForEvent } from '../src/lib/seedIndex.js';

const SCHEMA = fs.readFileSync(
  path.resolve(__dirname, '..', 'migrations', '001_init.sql'),
  'utf8',
);

let tmpDir: string;
let paths: StoragePaths;
let db: DB;
let app: FastifyInstance;

let minimalPng: Buffer;
let jpegWithExif: Buffer;

beforeAll(async () => {
  const tiny = { width: 1, height: 1, channels: 3 as const, background: 'red' };
  minimalPng = await sharp({ create: tiny }).png().toBuffer();
  jpegWithExif = await sharp({
    create: { width: 50, height: 100, channels: 3 as const, background: 'blue' },
  })
    .withMetadata({ orientation: 6 })
    .jpeg({ quality: 60 })
    .toBuffer();
});

async function buildApp() {
  app = Fastify();
  await app.register(multipart, { limits: { fileSize: 10 * 1024 * 1024 } });
  registerEventRoutes(app, db);
  registerMessageRoutes(app, db);
  registerPhotoRoutes(app, db, paths);
  await app.ready();
}

beforeEach(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mosaic-routes-'));
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

describe('GET /api/events', () => {
  it('returns all events', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/events' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as Array<{ id: string }>;
    expect(body.map((e) => e.id)).toEqual(['remembrance']);
  });
});

describe('GET /api/events/:id/photos', () => {
  it('404 for unknown event', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/events/nope/photos' });
    expect(res.statusCode).toBe(404);
  });

  it('returns seed photos with resolved URLs', async () => {
    const dir = path.join(paths.seedsDir, 'remembrance');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'one.jpg'), 'x');
    indexSeedsForEvent(db, paths, 'remembrance');
    const res = await app.inject({ method: 'GET', url: '/api/events/remembrance/photos' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as Array<{ url: string; source: string }>;
    expect(body).toHaveLength(1);
    expect(body[0]?.source).toBe('seed');
    expect(body[0]?.url).toBe('/data/seeds/remembrance/one.jpg');
  });
});

describe('POST /api/events/:id/messages', () => {
  it('rejects empty text', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/events/remembrance/messages',
      payload: { text: '   ' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('rejects text over 240 chars', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/events/remembrance/messages',
      payload: { text: 'x'.repeat(241) },
    });
    expect(res.statusCode).toBe(400);
  });

  it('persists a valid message and returns it', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/events/remembrance/messages',
      payload: { name: '  Eleanor  ', text: 'A memory.' },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json() as { name: string; text: string };
    expect(body.name).toBe('Eleanor');
    expect(body.text).toBe('A memory.');

    const list = await app.inject({
      method: 'GET',
      url: '/api/events/remembrance/messages',
    });
    expect((list.json() as unknown[]).length).toBe(1);
  });

  it('falls back to "A friend" when name is missing', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/events/remembrance/messages',
      payload: { text: 'hi' },
    });
    expect(res.statusCode).toBe(201);
    expect((res.json() as { name: string }).name).toBe('A friend');
  });
});

describe('POST /api/events/:id/photos', () => {
  async function uploadBuffer(
    buf: Buffer,
    filename: string,
    contentType: string,
  ): Promise<ReturnType<typeof app.inject>> {
    const boundary = '----test-boundary';
    const body = Buffer.concat([
      Buffer.from(`--${boundary}\r\n`),
      Buffer.from(
        `Content-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${contentType}\r\n\r\n`,
      ),
      buf,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);
    return app.inject({
      method: 'POST',
      url: '/api/events/remembrance/photos',
      headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
      payload: body,
    });
  }

  it('writes the file to uploads dir and returns photo with URL', async () => {
    const res = await uploadBuffer(minimalPng, 'pic.png', 'image/png');
    expect(res.statusCode).toBe(201);
    const body = res.json() as { id: string; filename: string; url: string; source: string };
    expect(body.source).toBe('upload');
    expect(body.filename.endsWith('.png')).toBe(true);
    expect(body.url).toBe(`/data/uploads/remembrance/${body.filename}`);
    expect(
      fs.existsSync(path.join(paths.uploadsDir, 'remembrance', body.filename)),
    ).toBe(true);
  });

  it('accepts JPEG with EXIF, strips metadata on disk', async () => {
    const res = await uploadBuffer(jpegWithExif, 'photo.jpg', 'image/jpeg');
    expect(res.statusCode).toBe(201);
    const body = res.json() as { filename: string };
    const onDisk = fs.readFileSync(path.join(paths.uploadsDir, 'remembrance', body.filename));
    const meta = await sharp(onDisk).metadata();
    expect(meta.exif).toBeUndefined();
  });

  it('rejects oversized upload with 413', async () => {
    // Fastify multipart truncates at 10MB limit — part.toBuffer() throws, we catch and return 413
    const big = Buffer.alloc(10 * 1024 * 1024 + 1);
    const res = await uploadBuffer(big, 'big.jpg', 'image/jpeg');
    expect(res.statusCode).toBe(413);
  });

  it('rejects GIF with 415 and documented error string', async () => {
    const gif = Buffer.from('R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==', 'base64');
    const res = await uploadBuffer(gif, 'anim.gif', 'image/gif');
    expect(res.statusCode).toBe(415);
    expect((res.json() as { error: string }).error).toBe(
      'unsupported image type — JPEG, PNG, or WebP only',
    );
  });

  it('rejects SVG with 415', async () => {
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"></svg>');
    const res = await uploadBuffer(svg, 'icon.svg', 'image/svg+xml');
    expect(res.statusCode).toBe(415);
  });

  it('rejects renamed binary with 400', async () => {
    const res = await uploadBuffer(Buffer.from('not an image'), 'trick.jpg', 'image/jpeg');
    expect(res.statusCode).toBe(400);
    expect((res.json() as { error: string }).error).toBe('invalid or corrupt image');
  });

  it('rejects an empty form (no file)', async () => {
    const boundary = '----test-boundary';
    const body = Buffer.from(`--${boundary}--\r\n`);
    const res = await app.inject({
      method: 'POST',
      url: '/api/events/remembrance/photos',
      headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
      payload: body,
    });
    expect(res.statusCode).toBe(400);
  });
});
