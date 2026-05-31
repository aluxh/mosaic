import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { ingestImage, MAX_FILE_BYTES } from '../src/lib/imageIngest.js';

let jpegWithOrientation: Buffer;
let plainPng: Buffer;
let plainWebp: Buffer;
let avifFixture: Buffer;
let tiffFixture: Buffer;
// Valid 1×1 GIF89a that sharp can parse — exercises the 415 (unsupported format) path
const gifFixture = Buffer.from('R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==', 'base64');
const svgFixture = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"></svg>');
let heicFixture: Buffer | null = null;
let heicReady = false;

beforeAll(async () => {
  const base = { width: 50, height: 100, channels: 3 as const, background: { r: 200, g: 150, b: 100 } };
  jpegWithOrientation = await sharp({ create: base })
    .withMetadata({ orientation: 6 })
    .jpeg({ quality: 60 })
    .toBuffer();

  const tiny = { width: 1, height: 1, channels: 3 as const, background: 'red' };
  plainPng   = await sharp({ create: tiny }).png().toBuffer();
  plainWebp  = await sharp({ create: tiny }).webp({ quality: 60 }).toBuffer();
  avifFixture = await sharp({ create: tiny }).avif({ quality: 60 }).toBuffer();
  tiffFixture = await sharp({ create: tiny }).tiff().toBuffer();

  const heicPath = path.resolve(__dirname, 'fixtures', 'iphone.heic');
  if (fs.existsSync(heicPath)) {
    heicFixture = fs.readFileSync(heicPath);
    try {
      const meta = await sharp(heicFixture).metadata();
      // Confirm it's HEVC HEIC AND the runtime can actually decode pixels (libde265).
      await sharp(heicFixture).jpeg().toBuffer();
      heicReady = meta.format === 'heif' && meta.compression === 'hevc';
    } catch {
      heicReady = false;
    }
  }
});

describe('ingestImage', () => {
  it('accepts JPEG with EXIF orientation=6, strips metadata, bakes rotation into pixels', async () => {
    const result = await ingestImage(jpegWithOrientation, MAX_FILE_BYTES);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.format).toBe('jpeg');
    expect(result.ext).toBe('.jpg');
    const meta = await sharp(result.buf).metadata();
    expect(meta.exif).toBeUndefined();
    expect(meta.width).toBe(100);
    expect(meta.height).toBe(50);
  });

  it('accepts PNG, strips metadata, returns format=png', async () => {
    const result = await ingestImage(plainPng, MAX_FILE_BYTES);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.format).toBe('png');
    expect(result.ext).toBe('.png');
    const meta = await sharp(result.buf).metadata();
    expect(meta.exif).toBeUndefined();
  });

  it('accepts WebP, returns format=webp', async () => {
    const result = await ingestImage(plainWebp, MAX_FILE_BYTES);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.format).toBe('webp');
    expect(result.ext).toBe('.webp');
  });

  it('rejects AVIF (heif + av1 compression) with 415', async () => {
    const result = await ingestImage(avifFixture, MAX_FILE_BYTES);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe(415);
    expect(result.error).toBe('unsupported image type — JPEG, PNG, WebP, or HEIC only');
  });

  it('accepts HEIC (heif + hevc), returns format=jpeg, ext=.jpg, JPEG buffer', async (ctx) => {
    if (!heicReady) { ctx.skip(); return; }
    const result = await ingestImage(heicFixture!, MAX_FILE_BYTES);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.format).toBe('jpeg');
    expect(result.ext).toBe('.jpg');
    const meta = await sharp(result.buf).metadata();
    expect(meta.format).toBe('jpeg');
    expect(meta.exif).toBeUndefined();
  });

  it('rejects GIF with 415', async () => {
    const result = await ingestImage(gifFixture, MAX_FILE_BYTES);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe(415);
    expect(result.error).toBe('unsupported image type — JPEG, PNG, WebP, or HEIC only');
  });

  it('rejects SVG with 415', async () => {
    const result = await ingestImage(svgFixture, MAX_FILE_BYTES);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe(415);
  });

  it('rejects TIFF with 415', async () => {
    const result = await ingestImage(tiffFixture, MAX_FILE_BYTES);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe(415);
  });

  it('rejects renamed binary with 400', async () => {
    const result = await ingestImage(Buffer.from('not an image'), MAX_FILE_BYTES);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe(400);
    expect(result.error).toBe('invalid or corrupt image');
  });

  it('rejects empty buffer with 400', async () => {
    const result = await ingestImage(Buffer.alloc(0), MAX_FILE_BYTES);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe(400);
  });

  it('rejects oversized buffer with 413', async () => {
    const big = Buffer.alloc(MAX_FILE_BYTES + 1);
    const result = await ingestImage(big, MAX_FILE_BYTES);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe(413);
    expect(result.error).toBe('file too large (max 10MB)' );
  });

  it('is idempotent — running ingestImage on its own output returns byte-equal result', async () => {
    const first = await ingestImage(jpegWithOrientation, MAX_FILE_BYTES);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const second = await ingestImage(first.buf, MAX_FILE_BYTES);
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.buf).toEqual(first.buf);
  });
});
