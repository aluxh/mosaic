import { describe, it, expect } from 'vitest';
import path from 'node:path';
import {
  makeStoragePaths,
  publicUrlForVariant,
  variantsDirFor,
} from '../src/lib/storage.js';

describe('storage variant helpers', () => {
  it('derives the variants dir from the data dir', () => {
    const paths = makeStoragePaths('/data');
    expect(paths.variantsDir).toBe(path.join('/data', 'variants'));
  });

  it('builds per-event variant dirs', () => {
    const paths = makeStoragePaths('/data');
    expect(variantsDirFor(paths, 'ev1')).toBe(path.join('/data', 'variants', 'ev1'));
  });

  it('builds variant public URLs with the width suffix and encoding', () => {
    expect(publicUrlForVariant('ev1', 'a b.jpg', 1024)).toBe('/data/variants/ev1/a%20b-1024.jpg');
    expect(publicUrlForVariant('ev1', 'x.png', 320)).toBe('/data/variants/ev1/x-320.png');
  });

  it('rejects unsafe event ids and filenames', () => {
    const paths = makeStoragePaths('/data');
    expect(() => variantsDirFor(paths, '../ev1')).toThrow('unsafe event id');
    expect(() => publicUrlForVariant('ev1', '../x.png', 320)).toThrow('unsafe filename');
  });
});
