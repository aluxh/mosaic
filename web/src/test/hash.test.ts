import { describe, it, expect } from 'vitest';
import { hash01, pickKenVariant } from '../lib/hash';

describe('hash01', () => {
  it('is deterministic for the same input', () => {
    expect(hash01('mosaic-wed-1')).toBe(hash01('mosaic-wed-1'));
    expect(hash01('foo', 7)).toBe(hash01('foo', 7));
  });

  it('returns a value in [0, 1)', () => {
    for (const seed of ['', 'a', 'mosaic-wed-1', 's0-c1', 's12-r4-msg']) {
      const v = hash01(seed);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('different salts produce different values', () => {
    const a = hash01('mosaic', 0);
    const b = hash01('mosaic', 11);
    expect(a).not.toBe(b);
  });

  it('different strings produce different values', () => {
    expect(hash01('mosaic-wed-1')).not.toBe(hash01('mosaic-wed-2'));
  });
});

describe('pickKenVariant', () => {
  it('returns one of the four ken classes', () => {
    const variants = ['ken-a', 'ken-b', 'ken-c', 'ken-d'];
    for (const seed of ['a', 'b', 'c', 'd', 's0-c1', 's12-mem']) {
      expect(variants).toContain(pickKenVariant(seed));
    }
  });

  it('is deterministic for the same seed', () => {
    expect(pickKenVariant('s0-c1')).toBe(pickKenVariant('s0-c1'));
  });
});
