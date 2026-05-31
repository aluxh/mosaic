import fs from 'node:fs';
import path from 'node:path';
import type { DB } from '../db/index.js';
import { insertPhoto, listEvents, photoExists } from '../db/queries.js';
import { seedsDirFor, type StoragePaths } from './storage.js';
import { ingestImage, MAX_FILE_BYTES } from './imageIngest.js';
import { ensureVariants } from './variants.js';

const ALLOWED_EXTS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.heic', '.heif']);

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
    const existingId = `seed-${eventId}-${filename}`;
    if (photoExists(db, existingId)) {
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

    // HEIC seeds transcode to JPEG: rename to result.ext and drop the original
    // so the stored photo (and its variants) use the .jpg name. For unchanged
    // extensions (jpg/png/webp) we just rewrite normalized bytes in place.
    const ext = path.extname(filename).toLowerCase();
    let storedName = filename;
    if (ext !== result.ext) {
      storedName = filename.slice(0, filename.length - ext.length) + result.ext;
      // Don't clobber an existing sibling (e.g. photo.heic alongside photo.jpg):
      // skip the transcode rather than silently overwrite the other file.
      if (fs.existsSync(path.join(dir, storedName))) {
        skipped += 1;
        skipped_reasons.push({ filename, reason: `rename target ${storedName} already exists` });
        continue;
      }
      fs.writeFileSync(path.join(dir, storedName), result.buf);
      fs.rmSync(file);
    } else if (!result.buf.equals(buf)) {
      fs.writeFileSync(file, result.buf);
    }

    insertPhoto(db, {
      id: `seed-${eventId}-${storedName}`,
      event_id: eventId,
      source: 'seed',
      filename: storedName,
      credit: 'Host',
      created_at: now(),
    });
    await ensureVariants(paths.variantsDir, eventId, storedName, result.buf, result.format);
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
