import fs from 'node:fs';
import path from 'node:path';
import type { DB } from '../db/index.js';
import { insertPhoto, listEvents, photoExists } from '../db/queries.js';
import { seedsDirFor, type StoragePaths } from './storage.js';

const ALLOWED_EXTS = new Set(['.jpg', '.jpeg', '.png', '.webp']);

export interface IndexResult {
  inserted: number;
  skipped: number;
}

export function indexSeedsForEvent(
  db: DB,
  paths: StoragePaths,
  eventId: string,
  now: () => number = Date.now,
): IndexResult {
  const dir = seedsDirFor(paths, eventId);
  if (!fs.existsSync(dir)) return { inserted: 0, skipped: 0 };

  const files = fs
    .readdirSync(dir)
    .filter((f) => ALLOWED_EXTS.has(path.extname(f).toLowerCase()))
    .sort();

  let inserted = 0;
  let skipped = 0;
  for (const filename of files) {
    const id = `seed-${eventId}-${filename}`;
    if (photoExists(db, id)) {
      skipped += 1;
      continue;
    }
    insertPhoto(db, {
      id,
      event_id: eventId,
      source: 'seed',
      filename,
      credit: 'Host',
      created_at: now(),
    });
    inserted += 1;
  }
  return { inserted, skipped };
}

export function indexAllSeeds(
  db: DB,
  paths: StoragePaths,
  now: () => number = Date.now,
): Record<string, IndexResult> {
  const out: Record<string, IndexResult> = {};
  for (const e of listEvents(db)) {
    out[e.id] = indexSeedsForEvent(db, paths, e.id, now);
  }
  return out;
}
