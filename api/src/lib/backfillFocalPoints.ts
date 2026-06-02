import fs from 'node:fs';
import path from 'node:path';
import type { DB } from '../db/index.js';
import { listAllPhotos, updatePhotoFocalPoint } from '../db/queries.js';
import { seedsDirFor, uploadsDirFor, type StoragePaths } from './storage.js';
import { detectFocalPoint } from './focalPoint.js';

export interface BackfillFocalPointsResult {
  updated: number;
  skipped: number;
}

export async function backfillFocalPoints(
  db: DB,
  paths: StoragePaths,
  eventId: string,
): Promise<BackfillFocalPointsResult> {
  let updated = 0;
  let skipped = 0;

  for (const row of listAllPhotos(db, eventId)) {
    if (row.focal_source !== 'unknown') {
      skipped += 1;
      continue;
    }

    const sourceDir = row.source === 'seed' ? seedsDirFor(paths, eventId) : uploadsDirFor(paths, eventId);
    const originalPath = path.join(sourceDir, row.filename);
    if (!fs.existsSync(originalPath)) {
      skipped += 1;
      continue;
    }

    const focal = await detectFocalPoint(fs.readFileSync(originalPath));
    if (updatePhotoFocalPoint(db, eventId, row.id, focal.focal_x, focal.focal_y, focal.source)) {
      updated += 1;
    }
  }

  return { updated, skipped };
}
