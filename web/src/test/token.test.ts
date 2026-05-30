import { afterEach, describe, expect, it } from 'vitest';
import { readToken } from '../lib/token';

afterEach(() => {
  window.location.hash = '';
});

describe('readToken', () => {
  it('parses #t=abc', () => {
    window.location.hash = '#t=abc';
    expect(readToken()).toBe('abc');
  });

  it('parses #t=abc&x=1', () => {
    window.location.hash = '#t=abc&x=1';
    expect(readToken()).toBe('abc');
  });

  it('returns null when there is no fragment', () => {
    window.location.hash = '';
    expect(readToken()).toBeNull();
  });

  it('returns null when the fragment lacks t', () => {
    window.location.hash = '#x=1';
    expect(readToken()).toBeNull();
  });
});
