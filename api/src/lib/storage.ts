import path from 'node:path';
import { variantFilename } from './variants.js';

export interface StoragePaths {
  dataDir: string;
  dbFile: string;
  seedsDir: string;
  uploadsDir: string;
  variantsDir: string;
}

export function makeStoragePaths(dataDir: string): StoragePaths {
  return {
    dataDir,
    dbFile: path.join(dataDir, 'mosaic.db'),
    seedsDir: path.join(dataDir, 'seeds'),
    uploadsDir: path.join(dataDir, 'uploads'),
    variantsDir: path.join(dataDir, 'variants'),
  };
}

export function seedsDirFor(paths: StoragePaths, eventId: string): string {
  return path.join(paths.seedsDir, eventId);
}

export function uploadsDirFor(paths: StoragePaths, eventId: string): string {
  return path.join(paths.uploadsDir, eventId);
}

export function variantsDirFor(paths: StoragePaths, eventId: string): string {
  return path.join(paths.variantsDir, eventId);
}

export function publicUrlForPhoto(source: 'seed' | 'upload', eventId: string, filename: string): string {
  const base = source === 'seed' ? '/data/seeds' : '/data/uploads';
  return `${base}/${eventId}/${encodeURIComponent(filename)}`;
}

export function publicUrlForVariant(eventId: string, filename: string, width: number): string {
  return `/data/variants/${eventId}/${encodeURIComponent(variantFilename(filename, width))}`;
}
