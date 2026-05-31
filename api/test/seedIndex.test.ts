import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { openDatabase, type DB } from '../src/db/index.js';
import { applySchemaFromString } from '../src/db/migrate.js';
import { upsertEvent, listPhotos } from '../src/db/queries.js';
import { indexSeedsForEvent } from '../src/lib/seedIndex.js';
import { makeStoragePaths, type StoragePaths, variantsDirFor } from '../src/lib/storage.js';

const migrationsDir = path.resolve(__dirname, '..', 'migrations');
const SCHEMA = fs
  .readdirSync(migrationsDir)
  .filter((f) => f.endsWith('.sql'))
  .sort()
  .map((f) => fs.readFileSync(path.join(migrationsDir, f), 'utf8'))
  .join('\n');

let validJpeg: Buffer;
let validPng: Buffer;
let validWebp: Buffer;
let heicFixture: Buffer | null = null;
let heicReady = false;

beforeAll(async () => {
  const tiny = { width: 1, height: 1, channels: 3 as const, background: 'red' };
  validJpeg = await sharp({ create: tiny }).jpeg({ quality: 60 }).toBuffer();
  validPng  = await sharp({ create: tiny }).png().toBuffer();
  validWebp = await sharp({ create: tiny }).webp({ quality: 60 }).toBuffer();

  const heicPath = path.resolve(__dirname, 'fixtures', 'iphone.heic');
  if (fs.existsSync(heicPath)) {
    heicFixture = fs.readFileSync(heicPath);
    try {
      const meta = await sharp(heicFixture).metadata();
      await sharp(heicFixture).jpeg().toBuffer();
      heicReady = meta.format === 'heif' && meta.compression === 'hevc';
    } catch {
      heicReady = false;
    }
  }
});

let tmpDir: string;
let paths: StoragePaths;
let db: DB;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mosaic-seed-'));
  paths = makeStoragePaths(tmpDir);
  fs.mkdirSync(paths.seedsDir, { recursive: true });
  db = openDatabase(':memory:');
  applySchemaFromString(db, SCHEMA);
  upsertEvent(db, {
    id: 'remembrance',
    mode: 'remembrance',
    eyebrow: 'In memory',
    title: 'X',
    dateline: 'date',
    place: 'place',
    invitation: 'invite',
    brand_sub: 'sub',
    short_code: 'X1',
  });
});

afterEach(() => {
  db.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('indexSeedsForEvent', () => {
  it('returns 0 when seeds folder is empty/missing', async () => {
    expect(await indexSeedsForEvent(db, paths, 'remembrance')).toEqual({
      inserted: 0,
      skipped: 0,
      skipped_reasons: [],
    });
  });

  it('indexes valid jpg/png/webp, skips non-image extensions', async () => {
    const dir = path.join(paths.seedsDir, 'remembrance');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'a.jpg'), validJpeg);
    fs.writeFileSync(path.join(dir, 'b.png'), validPng);
    fs.writeFileSync(path.join(dir, 'c.webp'), validWebp);
    fs.writeFileSync(path.join(dir, 'd.txt'), 'text');
    fs.writeFileSync(path.join(dir, 'e.gif'), 'gif');

    const result = await indexSeedsForEvent(db, paths, 'remembrance');
    expect(result.inserted).toBe(3);
    expect(result.skipped_reasons).toHaveLength(0);
    const filenames = listPhotos(db, 'remembrance').map((r) => r.filename).sort();
    expect(filenames).toEqual(['a.jpg', 'b.png', 'c.webp']);
  });

  it('indexes a HEIC seed as a .jpg photo, renames on disk, gets JPEG variants', async (ctx) => {
    if (!heicReady || !heicFixture) { ctx.skip(); return; }
    const dir = path.join(paths.seedsDir, 'remembrance');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'photo.heic'), heicFixture);

    const result = await indexSeedsForEvent(db, paths, 'remembrance');
    expect(result.inserted).toBe(1);

    const rows = listPhotos(db, 'remembrance');
    expect(rows).toHaveLength(1);
    expect(rows[0]!.filename).toBe('photo.jpg');

    expect(fs.existsSync(path.join(dir, 'photo.heic'))).toBe(false);
    expect(fs.existsSync(path.join(dir, 'photo.jpg'))).toBe(true);

    const vdir = variantsDirFor(paths, 'remembrance');
    expect(fs.existsSync(path.join(vdir, 'photo-1024.jpg'))).toBe(true);
    expect(fs.existsSync(path.join(vdir, 'photo-320.jpg'))).toBe(true);

    // Idempotent: a reboot finds only photo.jpg and skips it.
    const second = await indexSeedsForEvent(db, paths, 'remembrance');
    expect(second.inserted).toBe(0);
    expect(listPhotos(db, 'remembrance')).toHaveLength(1);
  });

  it('is idempotent — second run inserts nothing new', async () => {
    const dir = path.join(paths.seedsDir, 'remembrance');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'a.jpg'), validJpeg);
    fs.writeFileSync(path.join(dir, 'b.jpg'), validJpeg);

    expect(await indexSeedsForEvent(db, paths, 'remembrance')).toMatchObject({ inserted: 2, skipped: 0 });
    expect(await indexSeedsForEvent(db, paths, 'remembrance')).toMatchObject({ inserted: 0, skipped: 2 });
    expect(listPhotos(db, 'remembrance')).toHaveLength(2);
  });

  it('records seed photos with source=seed and credit=Host', async () => {
    const dir = path.join(paths.seedsDir, 'remembrance');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'photo.jpg'), validJpeg);
    await indexSeedsForEvent(db, paths, 'remembrance');
    const [row] = listPhotos(db, 'remembrance');
    expect(row?.source).toBe('seed');
    expect(row?.credit).toBe('Host');
    expect(row?.id).toContain('seed-');
  });

  it('strips EXIF from seed JPEG and rewrites the file', async () => {
    const dir = path.join(paths.seedsDir, 'remembrance');
    fs.mkdirSync(dir, { recursive: true });
    const jpegWithExif = await sharp({
      create: { width: 50, height: 100, channels: 3 as const, background: 'green' },
    })
      .withMetadata({ orientation: 6 })
      .jpeg({ quality: 60 })
      .toBuffer();
    const filePath = path.join(dir, 'portrait.jpg');
    fs.writeFileSync(filePath, jpegWithExif);

    await indexSeedsForEvent(db, paths, 'remembrance');

    const onDisk = fs.readFileSync(filePath);
    const meta = await sharp(onDisk).metadata();
    expect(meta.exif).toBeUndefined();
    expect(meta.width).toBe(100);
    expect(meta.height).toBe(50);
  });

  it('does not re-read or rewrite already-indexed seeds on second boot', async () => {
    const dir = path.join(paths.seedsDir, 'remembrance');
    fs.mkdirSync(dir, { recursive: true });
    const filePath = path.join(dir, 'a.jpg');
    fs.writeFileSync(filePath, validJpeg);

    await indexSeedsForEvent(db, paths, 'remembrance');
    const mtimeAfterFirst = fs.statSync(filePath).mtimeMs;

    await indexSeedsForEvent(db, paths, 'remembrance');
    const mtimeAfterSecond = fs.statSync(filePath).mtimeMs;

    expect(mtimeAfterSecond).toBe(mtimeAfterFirst);
    expect(listPhotos(db, 'remembrance')).toHaveLength(1);
  });

  it('skips invalid seed file, reports reason, still indexes valid sibling', async () => {
    const dir = path.join(paths.seedsDir, 'remembrance');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'bad.jpg'), Buffer.from('not an image'));
    fs.writeFileSync(path.join(dir, 'good.jpg'), validJpeg);

    const result = await indexSeedsForEvent(db, paths, 'remembrance');

    expect(result.inserted).toBe(1);
    expect(result.skipped_reasons).toHaveLength(1);
    expect(result.skipped_reasons[0]!.filename).toBe('bad.jpg');
    expect(result.skipped_reasons[0]!.reason).toBeTruthy();
    expect(listPhotos(db, 'remembrance')).toHaveLength(1);
    expect(listPhotos(db, 'remembrance')[0]!.filename).toBe('good.jpg');
  });

  it('writes variants on first index and never re-indexes a variant as a photo', async () => {
    const dir = path.join(paths.seedsDir, 'remembrance');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'a.jpg'), validJpeg);

    await indexSeedsForEvent(db, paths, 'remembrance');
    const vdir = variantsDirFor(paths, 'remembrance');
    expect(fs.existsSync(path.join(vdir, 'a-1024.jpg'))).toBe(true);
    expect(fs.existsSync(path.join(vdir, 'a-320.jpg'))).toBe(true);

    const second = await indexSeedsForEvent(db, paths, 'remembrance');
    expect(second.inserted).toBe(0);
    expect(listPhotos(db, 'remembrance')).toHaveLength(1);
  });
});
