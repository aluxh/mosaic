import { afterEach, describe, expect, it } from 'vitest';
import sharp from 'sharp';
import {
  __resetFocalPointForTest,
  __setFocalPointDetectorForTest,
  detectFocalPoint,
  focalPointFromFaces,
} from '../src/lib/focalPoint.js';

async function testImage(width = 100, height = 100): Promise<Buffer> {
  return sharp({
    create: { width, height, channels: 3 as const, background: 'white' },
  })
    .jpeg()
    .toBuffer();
}

afterEach(() => {
  __resetFocalPointForTest();
});

describe('focalPointFromFaces', () => {
  it('returns center when there are no faces', () => {
    expect(focalPointFromFaces(100, 100, [])).toEqual({ focal_x: 0.5, focal_y: 0.5 });
  });

  it('uses the union center for multiple faces', () => {
    expect(
      focalPointFromFaces(200, 100, [
        { x: 20, y: 10, width: 20, height: 20 },
        { x: 100, y: 30, width: 40, height: 40 },
      ]),
    ).toEqual({ focal_x: 0.4, focal_y: 0.4 });
  });

  it('clamps out-of-range focal coordinates', () => {
    expect(focalPointFromFaces(100, 100, [{ x: -50, y: 20, width: 250, height: 20 }])).toEqual({
      focal_x: 0.75,
      focal_y: 0.3,
    });
  });
});

describe('detectFocalPoint', () => {
  it('falls back to center when detector returns no usable faces', async () => {
    __setFocalPointDetectorForTest(async () => []);
    await expect(detectFocalPoint(await testImage())).resolves.toEqual({ focal_x: 0.5, focal_y: 0.5 });
  });

  it('caps detector concurrency at two', async () => {
    let active = 0;
    let maxActive = 0;
    __setFocalPointDetectorForTest(async () => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 20));
      active -= 1;
      return [{ x: 10, y: 10, width: 20, height: 20 }];
    });

    const buf = await testImage();
    await Promise.all([detectFocalPoint(buf), detectFocalPoint(buf), detectFocalPoint(buf), detectFocalPoint(buf)]);

    expect(maxActive).toBe(2);
  });
});
