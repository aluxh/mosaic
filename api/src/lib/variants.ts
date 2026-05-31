import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

export const VARIANT_WIDTHS = [1024, 320] as const;

export type VariantWidth = (typeof VARIANT_WIDTHS)[number];

export function variantFilename(filename: string, width: number): string {
  const ext = path.extname(filename);
  const base = filename.slice(0, filename.length - ext.length);
  return `${base}-${width}${ext}`;
}

export async function generateVariant(
  buf: Buffer,
  format: 'jpeg' | 'png' | 'webp',
  width: number,
): Promise<Buffer> {
  const pipeline = sharp(buf).resize({ width, withoutEnlargement: true });
  if (format === 'jpeg') {
    return pipeline.jpeg({ quality: width >= 1024 ? 82 : 75, mozjpeg: true }).toBuffer();
  }
  if (format === 'png') {
    return pipeline.png({ compressionLevel: 9 }).toBuffer();
  }
  return pipeline.webp({ quality: width >= 1024 ? 82 : 75 }).toBuffer();
}

export async function ensureVariants(
  variantsDir: string,
  filename: string,
  originalBuf: Buffer,
  format: 'jpeg' | 'png' | 'webp',
): Promise<void> {
  fs.mkdirSync(variantsDir, { recursive: true });
  for (const width of VARIANT_WIDTHS) {
    const target = path.join(variantsDir, variantFilename(filename, width));
    if (fs.existsSync(target)) continue;
    const out = await generateVariant(originalBuf, format, width);
    fs.writeFileSync(target, out);
  }
}
