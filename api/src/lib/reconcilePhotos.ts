import fs from 'node:fs';
import path from 'node:path';
import type { DB } from '../db/index.js';
import { deletePhotoCascade, listAllPhotos } from '../db/queries.js';
import type { PhotoRow, PhotoSource } from '../types.js';
import { safeFilename } from './pathSafety.js';
import { seedsDirFor, uploadsDirFor, type StoragePaths } from './storage.js';

export interface ReconcileRemovedPhoto {
  id: string;
  source: PhotoSource;
  filename: string;
}

export interface ReconcileResult {
  checked: number;
  removed: number;
  removedPhotos: ReconcileRemovedPhoto[];
}

function originalDir(paths: StoragePaths, eventId: string, source: PhotoSource): string {
  return source === 'seed' ? seedsDirFor(paths, eventId) : uploadsDirFor(paths, eventId);
}

function originalExists(paths: StoragePaths, eventId: string, row: PhotoRow): boolean {
  const filename = safeFilename(row.filename);
  return fs.existsSync(path.join(originalDir(paths, eventId, row.source), filename));
}

export function reconcileMissingPhotos(db: DB, paths: StoragePaths, eventId: string): ReconcileResult {
  const rows = listAllPhotos(db, eventId);
  const removedPhotos: ReconcileRemovedPhoto[] = [];

  for (const row of rows) {
    let exists = false;
    try {
      exists = originalExists(paths, eventId, row);
    } catch {
      exists = false;
    }
    if (exists) continue;

    const deleted = deletePhotoCascade(db, eventId, row.id);
    if (deleted) {
      removedPhotos.push({
        id: deleted.id,
        source: deleted.source,
        filename: deleted.filename,
      });
    }
  }

  return {
    checked: rows.length,
    removed: removedPhotos.length,
    removedPhotos,
  };
}
