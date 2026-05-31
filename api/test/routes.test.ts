import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
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
import { makeStoragePaths, type StoragePaths, variantsDirFor } from '../src/lib/storage.js';
import { indexSeedsForEvent } from '../src/lib/seedIndex.js';
import { makeRequireToken } from '../src/lib/auth.js';
import { signToken } from '../src/lib/token.js';
import { variantFilename } from '../src/lib/variants.js';

const TEST_SECRET = 'routes-test-secret';

const validAuth = (eid = 'remembrance'): string =>
  `Bearer ${signToken({ eid, exp: Math.floor(Date.now() / 1000) + 3600 }, TEST_SECRET)}`;
const expiredAuth = (eid = 'remembrance'): string =>
  `Bearer ${signToken({ eid, exp: Math.floor(Date.now() / 1000) - 10 }, TEST_SECRET)}`;
const badSigAuth = (eid = 'remembrance'): string =>
  `Bearer ${signToken({ eid, exp: Math.floor(Date.now() / 1000) + 3600 }, 'wrong-secret')}`;

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
let jpegWithExif: Buffer;

function rateLimitOptions(max: number) {
  return {
    max,
    timeWindow: 60_000,
    errorResponseBuilder: () => ({ statusCode: 429, error: 'too many requests' }),
  };
}

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
  await app.register(rateLimit, rateLimitOptions(100));
  const requireToken = makeRequireToken(TEST_SECRET);
  registerEventRoutes(app, db);
  registerMessageRoutes(app, db, requireToken);
  registerPhotoRoutes(app, db, paths, requireToken);
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
    fs.writeFileSync(path.join(dir, 'one.jpg'), minimalPng);
    await indexSeedsForEvent(db, paths, 'remembrance');
    const res = await app.inject({ method: 'GET', url: '/api/events/remembrance/photos' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as Array<{ url: string; url_1024: string; url_320: string; source: string }>;
    expect(body).toHaveLength(1);
    expect(body[0]?.source).toBe('seed');
    expect(body[0]?.url).toBe('/data/seeds/remembrance/one.jpg');
    expect(body[0]?.url_1024).toBe('/data/variants/remembrance/one-1024.jpg');
    expect(body[0]?.url_320).toBe('/data/variants/remembrance/one-320.jpg');
  });

  it('rate limits repeated photo list requests', async () => {
    await app.close();
    app = Fastify();
    await app.register(rateLimit, rateLimitOptions(1));
    registerEventRoutes(app, db);
    await app.ready();

    expect((await app.inject({ method: 'GET', url: '/api/events/remembrance/photos' })).statusCode).toBe(200);
    const limited = await app.inject({ method: 'GET', url: '/api/events/remembrance/photos' });
    expect(limited.statusCode).toBe(429);
    expect((limited.json() as { error: string }).error).toBe('too many requests');
  });
});

describe('POST /api/events/:id/messages', () => {
  it('rejects empty text', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/events/remembrance/messages',
      headers: { authorization: validAuth() },
      payload: { text: '   ' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('rejects text over 240 chars', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/events/remembrance/messages',
      headers: { authorization: validAuth() },
      payload: { text: 'x'.repeat(241) },
    });
    expect(res.statusCode).toBe(400);
  });

  it('persists a valid message and returns it', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/events/remembrance/messages',
      headers: { authorization: validAuth() },
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
      headers: { authorization: validAuth() },
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
    authHeader: string | null = validAuth(),
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
      headers: {
        'content-type': `multipart/form-data; boundary=${boundary}`,
        ...(authHeader ? { authorization: authHeader } : {}),
      },
      payload: body,
    });
  }

  it('writes the file to uploads dir and returns photo with URL', async () => {
    const res = await uploadBuffer(minimalPng, 'pic.png', 'image/png');
    expect(res.statusCode).toBe(201);
    const body = res.json() as {
      id: string;
      filename: string;
      url: string;
      url_1024: string;
      url_320: string;
      source: string;
    };
    expect(body.source).toBe('upload');
    expect(body.filename.endsWith('.png')).toBe(true);
    expect(body.url).toBe(`/data/uploads/remembrance/${body.filename}`);
    expect(
      fs.existsSync(path.join(paths.uploadsDir, 'remembrance', body.filename)),
    ).toBe(true);
    expect(body.url_1024).toBe(`/data/variants/remembrance/${variantFilename(body.filename, 1024)}`);
    expect(body.url_320).toBe(`/data/variants/remembrance/${variantFilename(body.filename, 320)}`);
    const vdir = variantsDirFor(paths, 'remembrance');
    expect(fs.existsSync(path.join(vdir, variantFilename(body.filename, 1024)))).toBe(true);
    expect(fs.existsSync(path.join(vdir, variantFilename(body.filename, 320)))).toBe(true);
  });

  it('rejects unsafe event ids before writing upload files', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/events/..%2Fevil/photos',
      headers: { authorization: validAuth('../evil') },
      payload: {},
    });
    expect(res.statusCode).toBe(404);
    expect(fs.existsSync(path.join(paths.uploadsDir, 'evil'))).toBe(false);
  });

  it('rate limits repeated photo uploads', async () => {
    await app.close();
    app = Fastify();
    await app.register(multipart, { limits: { fileSize: 10 * 1024 * 1024 } });
    await app.register(rateLimit, rateLimitOptions(1));
    const requireToken = makeRequireToken(TEST_SECRET);
    registerPhotoRoutes(app, db, paths, requireToken);
    await app.ready();

    expect((await uploadBuffer(minimalPng, 'one.png', 'image/png')).statusCode).toBe(201);
    const limited = await uploadBuffer(minimalPng, 'two.png', 'image/png');
    expect(limited.statusCode).toBe(429);
    expect((limited.json() as { error: string }).error).toBe('too many requests');
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
      headers: {
        'content-type': `multipart/form-data; boundary=${boundary}`,
        authorization: validAuth(),
      },
      payload: body,
    });
    expect(res.statusCode).toBe(400);
  });

  async function uploadWithFields(
    buf: Buffer,
    filename: string,
    contentType: string,
    fields: Record<string, string>,
    authHeader: string | null = validAuth(),
  ): Promise<ReturnType<typeof app.inject>> {
    const boundary = '----test-boundary';
    const parts: Buffer[] = [
      Buffer.from(`--${boundary}\r\n`),
      Buffer.from(
        `Content-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${contentType}\r\n\r\n`,
      ),
      buf,
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
    const headers: Record<string, string> = { 'content-type': `multipart/form-data; boundary=${boundary}` };
    if (authHeader) headers['authorization'] = authHeader;
    return app.inject({
      method: 'POST',
      url: '/api/events/remembrance/photos',
      headers,
      payload: Buffer.concat(parts),
    });
  }

  it('links a message when the message field is present', async () => {
    const res = await uploadWithFields(minimalPng, 'p.png', 'image/png', {
      credit: 'Maya',
      message: 'Wishing you joy',
    });
    expect(res.statusCode).toBe(201);
    const body = res.json() as {
      id: string;
      message: { id: string; photo_id: string; text: string } | null;
    };
    expect(body.message).not.toBeNull();
    expect(body.message?.photo_id).toBe(body.id);
    expect(body.message?.text).toBe('Wishing you joy');

    const list = await app.inject({ method: 'GET', url: '/api/events/remembrance/messages' });
    const msgs = list.json() as { photo_id: string | null }[];
    expect(msgs.some((m) => m.photo_id === body.id)).toBe(true);
  });

  it('returns message: null when no message field is sent', async () => {
    const res = await uploadWithFields(minimalPng, 'p.png', 'image/png', { credit: 'Maya' });
    expect(res.statusCode).toBe(201);
    expect((res.json() as { message: unknown }).message).toBeNull();
  });

  it('rejects an over-long message without writing the photo (atomic)', async () => {
    const res = await uploadWithFields(minimalPng, 'p.png', 'image/png', {
      credit: 'Maya',
      message: 'x'.repeat(241),
    });
    expect(res.statusCode).toBe(400);
    const photos = await app.inject({ method: 'GET', url: '/api/events/remembrance/photos' });
    expect((photos.json() as unknown[]).length).toBe(0);
    const msgs = await app.inject({ method: 'GET', url: '/api/events/remembrance/messages' });
    expect((msgs.json() as unknown[]).length).toBe(0);
  });
});

describe('write-endpoint token enforcement', () => {
  const SCAN_MSG = "This link can't be used to upload — scan the QR code at the event.";
  const EXPIRED_MSG = 'This event is no longer accepting uploads — ask the host for a new code.';

  function postMessage(authHeader: string | null) {
    return app.inject({
      method: 'POST',
      url: '/api/events/remembrance/messages',
      headers: authHeader ? { authorization: authHeader } : {},
      payload: { text: 'hello' },
    });
  }

  function postPhoto(authHeader: string | null) {
    const boundary = '----tok-boundary';
    const parts: Buffer[] = [
      Buffer.from(`--${boundary}\r\n`),
      Buffer.from(
        'Content-Disposition: form-data; name="file"; filename="p.png"\r\nContent-Type: image/png\r\n\r\n',
      ),
      minimalPng,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ];
    return app.inject({
      method: 'POST',
      url: '/api/events/remembrance/photos',
      headers: {
        'content-type': `multipart/form-data; boundary=${boundary}`,
        ...(authHeader ? { authorization: authHeader } : {}),
      },
      payload: Buffer.concat(parts),
    });
  }

  it('messages: 401 + scan message with no Authorization header', async () => {
    const res = await postMessage(null);
    expect(res.statusCode).toBe(401);
    expect((res.json() as { error: string }).error).toBe(SCAN_MSG);
  });

  it('messages: 401 + expired message with an expired token', async () => {
    const res = await postMessage(expiredAuth());
    expect(res.statusCode).toBe(401);
    expect((res.json() as { error: string }).error).toBe(EXPIRED_MSG);
  });

  it('messages: 401 with a bad-signature token', async () => {
    expect((await postMessage(badSigAuth())).statusCode).toBe(401);
  });

  it('messages: 401 with a token minted for another event', async () => {
    expect((await postMessage(validAuth('celebration'))).statusCode).toBe(401);
  });

  it('photos: 401 + scan message with no Authorization header', async () => {
    const res = await postPhoto(null);
    expect(res.statusCode).toBe(401);
    expect((res.json() as { error: string }).error).toBe(SCAN_MSG);
  });

  it('photos: 401 + expired message with an expired token', async () => {
    const res = await postPhoto(expiredAuth());
    expect(res.statusCode).toBe(401);
    expect((res.json() as { error: string }).error).toBe(EXPIRED_MSG);
  });

  it('photos: 401 with a bad-signature token', async () => {
    expect((await postPhoto(badSigAuth())).statusCode).toBe(401);
  });

  it('photos: 401 with a token minted for another event', async () => {
    expect((await postPhoto(validAuth('celebration'))).statusCode).toBe(401);
  });

  it('reads stay public — GET photos and messages need no token', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/events/remembrance/photos' })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/api/events/remembrance/messages' })).statusCode).toBe(200);
  });
});
