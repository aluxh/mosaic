import fs from 'node:fs';
import path from 'node:path';
import type { DB } from '../db/index.js';
import { listPhotos } from '../db/queries.js';
import {
  seedsDirFor,
  uploadsDirFor,
  variantsDirFor,
  type StoragePaths,
} from './storage.js';
import { ensureVariants, variantFilename, VARIANT_WIDTHS } from './variants.js';

function formatFromExt(filename: string): 'jpeg' | 'png' | 'webp' | null {
  const ext = path.extname(filename).toLowerCase();
  if (ext === '.jpg' || ext === '.jpeg') return 'jpeg';
  if (ext === '.png') return 'png';
  if (ext === '.webp') return 'webp';
  return null;
}

export async function backfillVariants(db: DB, paths: StoragePaths, eventId: string): Promise<void> {
  const variantsDir = variantsDirFor(paths, eventId);
  for (const row of listPhotos(db, eventId)) {
    const allPresent = VARIANT_WIDTHS.every((w) =>
      fs.existsSync(path.join(variantsDir, variantFilename(row.filename, w))),
    );
    if (allPresent) continue;

    const format = formatFromExt(row.filename);
    if (!format) continue;

    const sourceDir = row.source === 'seed' ? seedsDirFor(paths, eventId) : uploadsDirFor(paths, eventId);
    const originalPath = path.join(sourceDir, row.filename);
    if (!fs.existsSync(originalPath)) continue;

    await ensureVariants(variantsDir, row.filename, fs.readFileSync(originalPath), format);
  }
}
