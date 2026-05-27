import path from 'node:path';

export interface StoragePaths {
  dataDir: string;
  dbFile: string;
  seedsDir: string;
  uploadsDir: string;
}

export function makeStoragePaths(dataDir: string): StoragePaths {
  return {
    dataDir,
    dbFile: path.join(dataDir, 'mosaic.db'),
    seedsDir: path.join(dataDir, 'seeds'),
    uploadsDir: path.join(dataDir, 'uploads'),
  };
}

export function seedsDirFor(paths: StoragePaths, eventId: string): string {
  return path.join(paths.seedsDir, eventId);
}

export function uploadsDirFor(paths: StoragePaths, eventId: string): string {
  return path.join(paths.uploadsDir, eventId);
}

export function publicUrlForPhoto(source: 'seed' | 'upload', eventId: string, filename: string): string {
  const base = source === 'seed' ? '/data/seeds' : '/data/uploads';
  return `${base}/${eventId}/${encodeURIComponent(filename)}`;
}
