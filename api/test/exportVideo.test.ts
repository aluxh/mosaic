import { describe, it, expect } from 'vitest';
import { totalFrames, buildFfmpegArgs } from '../src/lib/exportVideo.js';

describe('totalFrames', () => {
  it('returns 0 for an empty sequence', () => {
    expect(totalFrames({ sequenceLength: 0, slideMs: 4200, fps: 30 })).toBe(0);
  });

  it('multiplies seconds of playback by fps', () => {
    // 3 slides * 4.2s = 12.6s * 30fps = 378 frames
    expect(totalFrames({ sequenceLength: 3, slideMs: 4200, fps: 30 })).toBe(378);
    // 9 slides * 7.2s = 64.8s * 30fps = 1944 frames
    expect(totalFrames({ sequenceLength: 9, slideMs: 7200, fps: 30 })).toBe(1944);
  });
});

describe('buildFfmpegArgs', () => {
  it('builds image2pipe → H.264 yuv420p args with the right resolution, fps, no audio, and output', () => {
    const args = buildFfmpegArgs({ width: 1920, height: 1080, fps: 30, output: '/data/exports/out.mp4' });
    expect(args).toContain('image2pipe');
    expect(args.join(' ')).toContain('scale=1920:1080');
    expect(args).toContain('libx264');
    const i = args.indexOf('-pix_fmt');
    expect(args[i + 1]).toBe('yuv420p');
    const r = args.indexOf('-r');
    expect(args[r + 1]).toBe('30');
    expect(args).toContain('-an');
    expect(args[args.length - 1]).toBe('/data/exports/out.mp4');
  });
});
