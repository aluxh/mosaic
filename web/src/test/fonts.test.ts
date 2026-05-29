import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { describe, it, expect } from 'vitest';

const here = path.dirname(fileURLToPath(import.meta.url));
const indexHtmlPath = path.resolve(here, '../../index.html');

describe('fonts', () => {
  it('does not load fonts from the Google Fonts CDN', () => {
    const html = readFileSync(indexHtmlPath, 'utf-8');
    expect(html).not.toMatch(/fonts\.googleapis\.com/);
    expect(html).not.toMatch(/fonts\.gstatic\.com/);
  });
});
