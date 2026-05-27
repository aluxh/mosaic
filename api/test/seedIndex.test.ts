import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDatabase, type DB } from '../src/db/index.js';
import { applySchemaFromString } from '../src/db/migrate.js';
import { upsertEvent, listPhotos } from '../src/db/queries.js';
import { indexSeedsForEvent } from '../src/lib/seedIndex.js';
import { makeStoragePaths, type StoragePaths } from '../src/lib/storage.js';

const SCHEMA = fs.readFileSync(
  path.resolve(__dirname, '..', 'migrations', '001_init.sql'),
  'utf8',
);

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
  it('returns 0 when seeds folder is empty/missing', () => {
    expect(indexSeedsForEvent(db, paths, 'remembrance')).toEqual({ inserted: 0, skipped: 0 });
  });

  it('indexes jpg/jpeg/png/webp files and skips others', () => {
    const dir = path.join(paths.seedsDir, 'remembrance');
    fs.mkdirSync(dir, { recursive: true });
    for (const name of ['a.jpg', 'b.jpeg', 'c.png', 'd.webp', 'e.txt', 'f.gif']) {
      fs.writeFileSync(path.join(dir, name), 'x');
    }
    const result = indexSeedsForEvent(db, paths, 'remembrance');
    expect(result.inserted).toBe(4);
    const rows = listPhotos(db, 'remembrance');
    const filenames = rows.map((r) => r.filename).sort();
    expect(filenames).toEqual(['a.jpg', 'b.jpeg', 'c.png', 'd.webp']);
  });

  it('is idempotent — second run inserts nothing new', () => {
    const dir = path.join(paths.seedsDir, 'remembrance');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'a.jpg'), 'x');
    fs.writeFileSync(path.join(dir, 'b.jpg'), 'x');

    expect(indexSeedsForEvent(db, paths, 'remembrance')).toEqual({ inserted: 2, skipped: 0 });
    expect(indexSeedsForEvent(db, paths, 'remembrance')).toEqual({ inserted: 0, skipped: 2 });
    expect(listPhotos(db, 'remembrance')).toHaveLength(2);
  });

  it('records seed photos with source=seed and credit=Host', () => {
    const dir = path.join(paths.seedsDir, 'remembrance');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'photo.jpg'), 'x');
    indexSeedsForEvent(db, paths, 'remembrance');
    const [row] = listPhotos(db, 'remembrance');
    expect(row?.source).toBe('seed');
    expect(row?.credit).toBe('Host');
    expect(row?.id).toContain('seed-');
  });
});
