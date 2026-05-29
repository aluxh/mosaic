import sharp from 'sharp';

export const MAX_FILE_BYTES = 10 * 1024 * 1024;

type IngestResult =
  | { ok: true; buf: Buffer; format: 'jpeg' | 'png' | 'webp'; ext: '.jpg' | '.png' | '.webp' }
  | { ok: false; code: 400 | 413 | 415; error: string };

const ALLOWED_FORMATS = new Set(['jpeg', 'png', 'webp']);

export async function ingestImage(input: Buffer, maxBytes: number): Promise<IngestResult> {
  if (input.byteLength > maxBytes) {
    return { ok: false, code: 413, error: `file too large (max ${Math.round(maxBytes / (1024 * 1024))}MB)` };
  }

  let meta: Awaited<ReturnType<sharp.Sharp['metadata']>>;
  try {
    meta = await sharp(input).metadata();
  } catch {
    return { ok: false, code: 400, error: 'invalid or corrupt image' };
  }

  if (!meta.format || !ALLOWED_FORMATS.has(meta.format)) {
    return { ok: false, code: 415, error: 'unsupported image type — JPEG, PNG, or WebP only' };
  }

  const format = meta.format as 'jpeg' | 'png' | 'webp';

  let buf: Buffer;
  if (format === 'jpeg') {
    buf = await sharp(input).rotate().jpeg({ quality: 95, mozjpeg: true }).toBuffer();
  } else if (format === 'png') {
    buf = await sharp(input).rotate().png({ compressionLevel: 9 }).toBuffer();
  } else {
    buf = await sharp(input).rotate().webp({ quality: 95 }).toBuffer();
  }

  const ext = format === 'jpeg' ? '.jpg' : format === 'png' ? '.png' : '.webp';
  return { ok: true, buf, format, ext };
}
