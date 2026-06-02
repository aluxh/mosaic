import type { Photo } from '../types';

export function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0.5;
  return Math.min(1, Math.max(0, n));
}

export function focalFromPoint(
  rect: { left: number; top: number; width: number; height: number },
  clientX: number,
  clientY: number,
): { x: number; y: number } {
  const x = rect.width > 0 ? (clientX - rect.left) / rect.width : 0.5;
  const y = rect.height > 0 ? (clientY - rect.top) / rect.height : 0.5;
  return { x: clamp01(x), y: clamp01(y) };
}

export function objectPositionForPhoto(photo: Pick<Photo, 'focalX' | 'focalY'>): string {
  return `${Math.round(clamp01(photo.focalX) * 100)}% ${Math.round(clamp01(photo.focalY) * 100)}%`;
}
