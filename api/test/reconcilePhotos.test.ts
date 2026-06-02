import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { openDatabase, type DB } from '../src/db/index.js';
import { applySchemaFromString } from '../src/db/migrate.js';
import {
  getPhotoForEvent,
  insertMessage,
  insertPhoto,
  listMessages,
  listPhotos,
  setPhotoHidden,
  upsertEvent,
} from '../src/db/queries.js';
import { reconcileMissingPhotos } from '../src/lib/reconcilePhotos.js';
import { indexSeedsForEvent } from '../src/lib/seedIndex.js';
import { makeStoragePaths, seedsDirFor, type StoragePaths, uploadsDirFor, variantsDirFor } from '../src/lib/storage.js';

const migrationsDir = path.resolve(__dirname, '..', 'migrations');
const SCHEMA = fs
  .readdirSync(migrationsDir)
  .filter((f) => f.endsWith('.sql'))
  .sort()
  .map((f) => fs.readFileSync(path.join(migrationsDir, f), 'utf8'))
  .join('\n');

let validJpeg: Buffer;
let tmpDir: string;
let paths: StoragePaths;
let db: DB;

beforeAll(async () => {
  validJpeg = await sharp({
    create: { width: 1, height: 1, channels: 3 as const, background: 'red' },
  }).jpeg({ quality: 60 }).toBuffer();
});

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mosaic-reconcile-'));
  paths = makeStoragePaths(tmpDir);
  fs.mkdirSync(seedsDirFor(paths, 'remembrance'), { recursive: true });
  fs.mkdirSync(uploadsDirFor(paths, 'remembrance'), { recursive: true });
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
    transition_style: 'default',
  });
});

afterEach(() => {
  db.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function addPhoto(id: string, source: 'seed' | 'upload', filename: string, createdAt = 1) {
  insertPhoto(db, {
    id,
    event_id: 'remembrance',
    source,
    filename,
    credit: 'A',
    created_at: createdAt,
  });
}

function writeOriginal(source: 'seed' | 'upload', filename: string) {
  const dir = source === 'seed' ? seedsDirFor(paths, 'remembrance') : uploadsDirFor(paths, 'remembrance');
  fs.writeFileSync(path.join(dir, filename), validJpeg);
}

describe('reconcileMissingPhotos', () => {
  it('keeps seed and upload rows whose original files exist', async () => {
    writeOriginal('seed', 'seed.jpg');
    writeOriginal('upload', 'upload.jpg');
    addPhoto('seed-present', 'seed', 'seed.jpg', 1);
    addPhoto('upload-present', 'upload', 'upload.jpg', 2);

    const result = reconcileMissingPhotos(db, paths, 'remembrance');

    expect(result).toEqual({ checked: 2, removed: 0, removedPhotos: [] });
    expect(listPhotos(db, 'remembrance').map((p) => p.id)).toEqual(['seed-present', 'upload-present']);
  });

  it('removes seed and upload rows whose original files are missing', () => {
    addPhoto('seed-missing', 'seed', 'missing-seed.jpg', 1);
    addPhoto('upload-missing', 'upload', 'missing-upload.jpg', 2);

    const result = reconcileMissingPhotos(db, paths, 'remembrance');

    expect(result.removed).toBe(2);
    expect(result.removedPhotos.map((p) => p.id)).toEqual(['seed-missing', 'upload-missing']);
    expect(listPhotos(db, 'remembrance')).toEqual([]);
  });

  it('removes linked messages and leaves standalone messages', () => {
    addPhoto('photo-missing', 'upload', 'gone.jpg');
    insertMessage(db, {
      id: 'linked',
      event_id: 'remembrance',
      name: 'A',
      text: 'linked',
      created_at: 1,
      photo_id: 'photo-missing',
    });
    insertMessage(db, {
      id: 'standalone',
      event_id: 'remembrance',
      name: 'B',
      text: 'standalone',
      created_at: 2,
    });

    reconcileMissingPhotos(db, paths, 'remembrance');

    expect(listMessages(db, 'remembrance').map((m) => m.id)).toEqual(['standalone']);
  });

  it('checks hidden photos and removes a hidden row when its original is missing', () => {
    addPhoto('hidden-missing', 'seed', 'hidden.jpg');
    setPhotoHidden(db, 'remembrance', 'hidden-missing', true);

    const result = reconcileMissingPhotos(db, paths, 'remembrance');

    expect(result.removedPhotos.map((p) => p.id)).toEqual(['hidden-missing']);
    expect(getPhotoForEvent(db, 'remembrance', 'hidden-missing')).toBeUndefined();
  });

  it('treats unsafe filenames as stale without reading arbitrary paths', () => {
    addPhoto('unsafe', 'seed', '../escape.jpg');
    fs.writeFileSync(path.join(tmpDir, 'escape.jpg'), validJpeg);

    const result = reconcileMissingPhotos(db, paths, 'remembrance');

    expect(result.removedPhotos.map((p) => p.id)).toEqual(['unsafe']);
    expect(fs.existsSync(path.join(tmpDir, 'escape.jpg'))).toBe(true);
  });

  it('is idempotent after removing stale rows', () => {
    writeOriginal('seed', 'present.jpg');
    addPhoto('present', 'seed', 'present.jpg', 1);
    addPhoto('missing', 'seed', 'missing.jpg', 2);

    expect(reconcileMissingPhotos(db, paths, 'remembrance')).toMatchObject({ checked: 2, removed: 1 });
    expect(reconcileMissingPhotos(db, paths, 'remembrance')).toMatchObject({ checked: 1, removed: 0 });
    expect(listPhotos(db, 'remembrance').map((p) => p.id)).toEqual(['present']);
  });

  it('runs before seed indexing in the boot flow', async () => {
    addPhoto('stale', 'seed', 'missing.jpg', 1);
    fs.writeFileSync(path.join(seedsDirFor(paths, 'remembrance'), 'new.jpg'), validJpeg);

    reconcileMissingPhotos(db, paths, 'remembrance');
    await indexSeedsForEvent(db, paths, 'remembrance', () => 2);

    expect(listPhotos(db, 'remembrance').map((p) => p.id)).toEqual(['seed-remembrance-new.jpg']);
  });

  it('does not delete variant files for stale rows', () => {
    addPhoto('stale', 'seed', 'gone.jpg');
    const variantsDir = variantsDirFor(paths, 'remembrance');
    fs.mkdirSync(variantsDir, { recursive: true });
    fs.writeFileSync(path.join(variantsDir, 'gone-320.jpg'), validJpeg);

    reconcileMissingPhotos(db, paths, 'remembrance');

    expect(fs.existsSync(path.join(variantsDir, 'gone-320.jpg'))).toBe(true);
  });
});
