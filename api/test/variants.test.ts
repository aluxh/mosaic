import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import {
  VARIANT_WIDTHS,
  ensureVariants,
  generateVariant,
  variantFilename,
} from '../src/lib/variants.js';

async function solid(width: number, height: number, format: 'jpeg' | 'png' | 'webp') {
  const img = sharp({
    create: { width, height, channels: 3, background: { r: 10, g: 20, b: 30 } },
  });
  if (format === 'jpeg') return img.jpeg().toBuffer();
  if (format === 'png') return img.png().toBuffer();
  return img.webp().toBuffer();
}

describe('VARIANT_WIDTHS', () => {
  it('is [1024, 320]', () => {
    expect(VARIANT_WIDTHS).toEqual([1024, 320]);
  });
});

describe('variantFilename', () => {
  it('inserts the width before the extension', () => {
    expect(variantFilename('grandma.jpg', 1024)).toBe('grandma-1024.jpg');
    expect(variantFilename('grandma.jpg', 320)).toBe('grandma-320.jpg');
  });

  it('preserves png and webp extensions', () => {
    expect(variantFilename('logo.png', 320)).toBe('logo-320.png');
    expect(variantFilename('shot.webp', 1024)).toBe('shot-1024.webp');
  });

  it('handles a stem that itself contains a dash', () => {
    expect(variantFilename('a-b.jpg', 1024)).toBe('a-b-1024.jpg');
  });
});

describe('generateVariant', () => {
  it('downscales a larger source to the target width, preserving format', async () => {
    const out = await generateVariant(await solid(2000, 1000, 'jpeg'), 'jpeg', 1024);
    const meta = await sharp(out).metadata();
    expect(meta.width).toBe(1024);
    expect(meta.format).toBe('jpeg');
  });

  it('does not upscale a source narrower than the target', async () => {
    const out = await generateVariant(await solid(200, 100, 'jpeg'), 'jpeg', 1024);
    expect((await sharp(out).metadata()).width).toBe(200);
  });

  it('keeps png and webp source formats', async () => {
    const png = await generateVariant(await solid(800, 400, 'png'), 'png', 320);
    expect((await sharp(png).metadata()).format).toBe('png');
    const webp = await generateVariant(await solid(800, 400, 'webp'), 'webp', 320);
    expect((await sharp(webp).metadata()).format).toBe('webp');
  });
});

describe('ensureVariants', () => {
  it('writes both width files, creating the dir, and is idempotent', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mosaic-variants-'));
    const variantsDir = path.join(dir, 'variants', 'ev1');
    const original = await solid(2000, 1000, 'jpeg');

    await ensureVariants(path.join(dir, 'variants'), 'ev1', 'pic.jpg', original, 'jpeg');
    const f1024 = path.join(variantsDir, 'pic-1024.jpg');
    const f320 = path.join(variantsDir, 'pic-320.jpg');
    expect(fs.existsSync(f1024)).toBe(true);
    expect(fs.existsSync(f320)).toBe(true);

    const mtime1024 = fs.statSync(f1024).mtimeMs;
    await new Promise((r) => setTimeout(r, 10));
    await ensureVariants(path.join(dir, 'variants'), 'ev1', 'pic.jpg', original, 'jpeg');
    expect(fs.statSync(f1024).mtimeMs).toBe(mtime1024);

    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('rejects unsafe event ids and filenames', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mosaic-variants-'));
    const original = await solid(2000, 1000, 'jpeg');

    await expect(ensureVariants(path.join(dir, 'variants'), '../ev1', 'pic.jpg', original, 'jpeg')).rejects.toThrow(
      'unsafe event id',
    );
    await expect(ensureVariants(path.join(dir, 'variants'), 'ev1', '../pic.jpg', original, 'jpeg')).rejects.toThrow(
      'unsafe filename',
    );

    fs.rmSync(dir, { recursive: true, force: true });
  });
});
