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
  it('builds image2pipe → H.264 yuv420p args for real-time screencast frames', () => {
    const args = buildFfmpegArgs({ fps: 30, output: '/data/exports/out.mp4' });
    expect(args).toContain('image2pipe');
    // Wallclock-stamp variable-rate screencast frames, then resample to constant fps.
    const wc = args.indexOf('-use_wallclock_as_timestamps');
    expect(args[wc + 1]).toBe('1');
    const vf = args.indexOf('-vf');
    expect(args[vf + 1]).toBe('fps=30');
    expect(args).toContain('libx264');
    const preset = args.indexOf('-preset');
    expect(args[preset + 1]).toBe('veryfast');
    const i = args.indexOf('-pix_fmt');
    expect(args[i + 1]).toBe('yuv420p');
    expect(args).toContain('-an');
    expect(args[args.length - 1]).toBe('/data/exports/out.mp4');
  });
});
