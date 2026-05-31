import sharp from 'sharp';

export const MAX_FILE_BYTES = 10 * 1024 * 1024;

type IngestResult =
  | { ok: true; buf: Buffer; format: 'jpeg' | 'png' | 'webp'; ext: '.jpg' | '.png' | '.webp' }
  | { ok: false; code: 400 | 413 | 415; error: string };

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

  // Sharp reports both HEIC and AVIF as format 'heif'; they differ only by
  // compression. Accept HEVC-compressed HEIF (real iPhone HEIC); AVIF ('av1')
  // stays rejected.
  const isHeic = meta.format === 'heif' && meta.compression === 'hevc';
  const accepted =
    meta.format === 'jpeg' || meta.format === 'png' || meta.format === 'webp' || isHeic;
  if (!accepted) {
    return { ok: false, code: 415, error: 'unsupported image type — JPEG, PNG, WebP, or HEIC only' };
  }

  // HEIC normalizes to JPEG, matching the existing JPEG path (rotate + strip EXIF).
  const outFormat: 'jpeg' | 'png' | 'webp' =
    meta.format === 'png' ? 'png' : meta.format === 'webp' ? 'webp' : 'jpeg';

  let buf: Buffer;
  if (outFormat === 'jpeg') {
    buf = await sharp(input).rotate().jpeg({ quality: 95, mozjpeg: true }).toBuffer();
  } else if (outFormat === 'png') {
    buf = await sharp(input).rotate().png({ compressionLevel: 9 }).toBuffer();
  } else {
    buf = await sharp(input).rotate().webp({ quality: 95 }).toBuffer();
  }

  const ext = outFormat === 'jpeg' ? '.jpg' : outFormat === 'png' ? '.png' : '.webp';
  return { ok: true, buf, format: outFormat, ext };
}
