import fs from 'node:fs';
import path from 'node:path';
import type { DB } from '../db/index.js';
import { insertPhoto, listEvents, photoExists } from '../db/queries.js';
import { seedsDirFor, variantsDirFor, type StoragePaths } from './storage.js';
import { ingestImage, MAX_FILE_BYTES } from './imageIngest.js';
import { ensureVariants } from './variants.js';

const ALLOWED_EXTS = new Set(['.jpg', '.jpeg', '.png', '.webp']);

export interface IndexResult {
  inserted: number;
  skipped: number;
  skipped_reasons: { filename: string; reason: string }[];
}

export async function indexSeedsForEvent(
  db: DB,
  paths: StoragePaths,
  eventId: string,
  now: () => number = Date.now,
): Promise<IndexResult> {
  const dir = seedsDirFor(paths, eventId);
  if (!fs.existsSync(dir)) return { inserted: 0, skipped: 0, skipped_reasons: [] };

  const files = fs
    .readdirSync(dir)
    .filter((f) => ALLOWED_EXTS.has(path.extname(f).toLowerCase()))
    .sort();

  let inserted = 0;
  let skipped = 0;
  const skipped_reasons: { filename: string; reason: string }[] = [];

  for (const filename of files) {
    const id = `seed-${eventId}-${filename}`;
    if (photoExists(db, id)) {
      skipped += 1;
      continue;
    }

    const file = path.join(dir, filename);
    const buf = fs.readFileSync(file);
    const result = await ingestImage(buf, MAX_FILE_BYTES);

    if (!result.ok) {
      skipped += 1;
      skipped_reasons.push({ filename, reason: result.error });
      continue;
    }

    if (!result.buf.equals(buf)) {
      fs.writeFileSync(file, result.buf);
    }

    insertPhoto(db, {
      id,
      event_id: eventId,
      source: 'seed',
      filename,
      credit: 'Host',
      created_at: now(),
    });
    await ensureVariants(variantsDirFor(paths, eventId), filename, result.buf, result.format);
    inserted += 1;
  }

  return { inserted, skipped, skipped_reasons };
}

export async function indexAllSeeds(
  db: DB,
  paths: StoragePaths,
  now: () => number = Date.now,
): Promise<Record<string, IndexResult>> {
  const out: Record<string, IndexResult> = {};
  for (const e of listEvents(db)) {
    out[e.id] = await indexSeedsForEvent(db, paths, e.id, now);
  }
  return out;
}
