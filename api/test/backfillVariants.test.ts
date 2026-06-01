import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { openDatabase, type DB } from '../src/db/index.js';
import { applySchemaFromString } from '../src/db/migrate.js';
import { upsertEvent, insertPhoto } from '../src/db/queries.js';
import { backfillVariants } from '../src/lib/backfillVariants.js';
import { makeStoragePaths, type StoragePaths, seedsDirFor, variantsDirFor } from '../src/lib/storage.js';

const migrationsDir = path.resolve(__dirname, '..', 'migrations');
const SCHEMA = fs
  .readdirSync(migrationsDir)
  .filter((f) => f.endsWith('.sql'))
  .sort()
  .map((f) => fs.readFileSync(path.join(migrationsDir, f), 'utf8'))
  .join('\n');

const eventId = 'remembrance';

async function makeJpeg(width = 2000): Promise<Buffer> {
  return sharp({
    create: { width, height: 1000, channels: 3, background: { r: 1, g: 2, b: 3 } },
  })
    .jpeg()
    .toBuffer();
}

let tmpDir: string;
let db: DB;
let paths: StoragePaths;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mosaic-backfill-'));
  paths = makeStoragePaths(tmpDir);
  fs.mkdirSync(paths.seedsDir, { recursive: true });
  db = openDatabase(':memory:');
  applySchemaFromString(db, SCHEMA);
  upsertEvent(db, {
    id: eventId,
    mode: 'remembrance',
    eyebrow: 'In memory',
    title: 'X',
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

function seedRow() {
  const seedDir = seedsDirFor(paths, eventId);
  fs.mkdirSync(seedDir, { recursive: true });
  return seedDir;
}

describe('backfillVariants', () => {
  it('generates missing variants for an existing seed row from its source original', async () => {
    const seedDir = seedRow();
    fs.writeFileSync(path.join(seedDir, 'a.jpg'), await makeJpeg());
    insertPhoto(db, {
      id: `seed-${eventId}-a.jpg`,
      event_id: eventId,
      source: 'seed',
      filename: 'a.jpg',
      credit: 'Host',
      created_at: 1,
    });

    await backfillVariants(db, paths, eventId);

    const vdir = variantsDirFor(paths, eventId);
    expect(fs.existsSync(path.join(vdir, 'a-1024.jpg'))).toBe(true);
    expect(fs.existsSync(path.join(vdir, 'a-320.jpg'))).toBe(true);
  });

  it('leaves pre-existing variant files untouched', async () => {
    const seedDir = seedRow();
    fs.writeFileSync(path.join(seedDir, 'a.jpg'), await makeJpeg());
    insertPhoto(db, {
      id: `seed-${eventId}-a.jpg`,
      event_id: eventId,
      source: 'seed',
      filename: 'a.jpg',
      credit: 'Host',
      created_at: 1,
    });

    await backfillVariants(db, paths, eventId);
    const f1024 = path.join(variantsDirFor(paths, eventId), 'a-1024.jpg');
    const mtime = fs.statSync(f1024).mtimeMs;

    await new Promise((r) => setTimeout(r, 10));
    await backfillVariants(db, paths, eventId);
    expect(fs.statSync(f1024).mtimeMs).toBe(mtime);
  });
});
