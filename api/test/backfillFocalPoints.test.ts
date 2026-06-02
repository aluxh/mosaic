import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { openDatabase, type DB } from '../src/db/index.js';
import { applySchemaFromString } from '../src/db/migrate.js';
import { insertPhoto, listAllPhotos, upsertEvent } from '../src/db/queries.js';
import { backfillFocalPoints } from '../src/lib/backfillFocalPoints.js';
import { makeStoragePaths, seedsDirFor, type StoragePaths } from '../src/lib/storage.js';
import {
  __resetFocalPointForTest,
  __setFocalPointDetectorForTest,
} from '../src/lib/focalPoint.js';

const migrationsDir = path.resolve(__dirname, '..', 'migrations');
const SCHEMA = fs
  .readdirSync(migrationsDir)
  .filter((f) => f.endsWith('.sql'))
  .sort()
  .map((f) => fs.readFileSync(path.join(migrationsDir, f), 'utf8'))
  .join('\n');

const eventId = 'remembrance';

let tmpDir: string;
let db: DB;
let paths: StoragePaths;

async function makeJpeg(): Promise<Buffer> {
  return sharp({
    create: { width: 100, height: 100, channels: 3 as const, background: 'white' },
  })
    .jpeg()
    .toBuffer();
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mosaic-focal-backfill-'));
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
  __setFocalPointDetectorForTest(async () => [{ x: 10, y: 20, width: 30, height: 40 }]);
});

afterEach(() => {
  __resetFocalPointForTest();
  db.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('backfillFocalPoints', () => {
  it('processes only unknown rows and stamps the detected source', async () => {
    const seedDir = seedsDirFor(paths, eventId);
    fs.mkdirSync(seedDir, { recursive: true });
    fs.writeFileSync(path.join(seedDir, 'a.jpg'), await makeJpeg());
    insertPhoto(db, {
      id: 'p1',
      event_id: eventId,
      source: 'seed',
      filename: 'a.jpg',
      credit: 'Host',
      created_at: 1,
      // focal_source defaults to 'unknown'
    });

    await expect(backfillFocalPoints(db, paths, eventId)).resolves.toEqual({ updated: 1, skipped: 0 });

    expect(listAllPhotos(db, eventId)[0]).toMatchObject({
      focal_x: 0.25,
      focal_y: 0.4,
      focal_source: 'detected',
    });
  });

  it('skips manual, detected, and fallback rows and missing originals', async () => {
    insertPhoto(db, {
      id: 'manual',
      event_id: eventId,
      source: 'seed',
      filename: 'a.jpg',
      credit: 'Host',
      created_at: 1,
      focal_x: 0.2,
      focal_y: 0.3,
      focal_source: 'manual',
    });
    insertPhoto(db, {
      id: 'fallback',
      event_id: eventId,
      source: 'seed',
      filename: 'a.jpg',
      credit: 'Host',
      created_at: 2,
      focal_source: 'fallback',
    });
    insertPhoto(db, {
      id: 'missing-unknown',
      event_id: eventId,
      source: 'seed',
      filename: 'missing.jpg',
      credit: 'Host',
      created_at: 3,
    });

    await expect(backfillFocalPoints(db, paths, eventId)).resolves.toEqual({ updated: 0, skipped: 3 });
    expect(listAllPhotos(db, eventId).find((r) => r.id === 'manual')).toMatchObject({
      focal_x: 0.2,
      focal_y: 0.3,
      focal_source: 'manual',
    });
  });
});
