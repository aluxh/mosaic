import { describe, it, expect } from 'vitest';
import { clamp01, focalFromPoint, objectPositionForPhoto } from '../lib/focalPoint';

describe('clamp01', () => {
  it('clamps to the 0..1 range and defaults non-finite to 0.5', () => {
    expect(clamp01(-0.4)).toBe(0);
    expect(clamp01(1.4)).toBe(1);
    expect(clamp01(0.3)).toBe(0.3);
    expect(clamp01(Number.NaN)).toBe(0.5);
  });
});

describe('focalFromPoint', () => {
  const rect = { left: 100, top: 50, width: 200, height: 400 };

  it('converts a pointer position inside the rect to a 0..1 focal point', () => {
    expect(focalFromPoint(rect, 150, 250)).toEqual({ x: 0.25, y: 0.5 });
  });

  it('clamps points outside the rect to the image bounds', () => {
    expect(focalFromPoint(rect, 0, 1000)).toEqual({ x: 0, y: 1 });
    expect(focalFromPoint(rect, 9999, 0)).toEqual({ x: 1, y: 0 });
  });

  it('returns center for a zero-size rect', () => {
    expect(focalFromPoint({ left: 0, top: 0, width: 0, height: 0 }, 10, 10)).toEqual({ x: 0.5, y: 0.5 });
  });
});

describe('objectPositionForPhoto', () => {
  it('formats focal coordinates as a percentage object-position', () => {
    expect(objectPositionForPhoto({ focalX: 0.25, focalY: 0.5 })).toBe('25% 50%');
  });
});
