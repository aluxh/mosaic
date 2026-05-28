import { describe, it, expect, afterEach, vi } from 'vitest';
import { resolveEventMode } from '../src/lib/seedEvents.js';

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.EVENT_MODE;
});

describe('resolveEventMode', () => {
  it('returns celebration when EVENT_MODE=celebration', () => {
    process.env.EVENT_MODE = 'celebration';
    expect(resolveEventMode()).toBe('celebration');
  });

  it('returns remembrance when EVENT_MODE=remembrance', () => {
    process.env.EVENT_MODE = 'remembrance';
    expect(resolveEventMode()).toBe('remembrance');
  });

  it('defaults to celebration and warns when EVENT_MODE is unset', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    delete process.env.EVENT_MODE;
    expect(resolveEventMode()).toBe('celebration');
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('EVENT_MODE'));
  });

  it('defaults to celebration and warns when EVENT_MODE is invalid', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    process.env.EVENT_MODE = 'lasagna';
    expect(resolveEventMode()).toBe('celebration');
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('EVENT_MODE'));
  });
});
