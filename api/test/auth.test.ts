import { describe, it, expect } from 'vitest';
import { requireTokenSecret } from '../src/lib/auth.js';

describe('requireTokenSecret', () => {
  it('returns the secret when set', () => {
    expect(requireTokenSecret({ TOKEN_SECRET: 's3cret' } as NodeJS.ProcessEnv)).toBe('s3cret');
  });

  it('throws when missing; message mentions TOKEN_SECRET and mint-token', () => {
    expect(() => requireTokenSecret({} as NodeJS.ProcessEnv)).toThrow(/TOKEN_SECRET/);
    expect(() => requireTokenSecret({} as NodeJS.ProcessEnv)).toThrow(/mint-token/);
  });

  it('throws on an empty string', () => {
    expect(() => requireTokenSecret({ TOKEN_SECRET: '' } as NodeJS.ProcessEnv)).toThrow();
  });
});
