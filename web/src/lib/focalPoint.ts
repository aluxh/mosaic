import type { Photo } from '../types';

function pct(n: number): number {
  if (!Number.isFinite(n)) return 50;
  return Math.round(Math.min(1, Math.max(0, n)) * 100);
}

export function objectPositionForPhoto(photo: Pick<Photo, 'focalX' | 'focalY'>): string {
  return `${pct(photo.focalX)}% ${pct(photo.focalY)}%`;
}
