import { describe, it, expect } from 'vitest';
import { totalFrames, buildFfmpegArgs, buildConcatManifest } from '../src/lib/exportVideo.js';

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

describe('buildConcatManifest', () => {
  it('produces correct ffconcat header, file entries, and durations', () => {
    const frames = [
      { file: '/tmp/f-0.jpg', tsMs: 0 },
      { file: '/tmp/f-1.jpg', tsMs: 100 },
      { file: '/tmp/f-2.jpg', tsMs: 250 },
    ];
    const manifest = buildConcatManifest(frames);
    expect(manifest).toContain('ffconcat version 1.0');
    expect(manifest).toContain("file '/tmp/f-0.jpg'");
    expect(manifest).toContain('duration 0.100000');  // 100ms between 0→1
    expect(manifest).toContain("file '/tmp/f-1.jpg'");
    expect(manifest).toContain('duration 0.150000');  // 150ms between 1→2
    expect(manifest).toContain("file '/tmp/f-2.jpg'");
    // Last entry has no duration line
    const afterLast = manifest.slice(manifest.lastIndexOf("file '/tmp/f-2.jpg'") + 20);
    expect(afterLast.trim()).toBe('');
  });

  it('returns a single-frame manifest with no duration', () => {
    const manifest = buildConcatManifest([{ file: '/a.jpg', tsMs: 0 }]);
    expect(manifest).toContain('ffconcat version 1.0');
    expect(manifest).toContain("file '/a.jpg'");
    expect(manifest).not.toContain('duration');
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
