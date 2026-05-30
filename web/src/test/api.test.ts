import { afterEach, describe, expect, it, vi } from 'vitest';
import { uploadPhoto, postMessage } from '../lib/api';

const okPhoto = {
  id: 'p1',
  event_id: 'remembrance',
  source: 'upload',
  url: '/data/uploads/remembrance/p1.png',
  credit: 'Maya',
  created_at: 1,
  message: null,
};
const okMessage = {
  id: 'm1',
  event_id: 'remembrance',
  name: 'A friend',
  text: 'hi',
  created_at: 1,
  photo_id: null,
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('uploadPhoto', () => {
  it('sets a Bearer header when a token is provided', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => okPhoto });
    vi.stubGlobal('fetch', fetchMock);
    const file = new File(['x'], 'p.png', { type: 'image/png' });
    await uploadPhoto('remembrance', file, 'Maya', undefined, 'tok123');
    expect(fetchMock.mock.calls[0]![1].headers).toMatchObject({ Authorization: 'Bearer tok123' });
  });

  it('sends no Authorization header when no token is provided', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => okPhoto });
    vi.stubGlobal('fetch', fetchMock);
    const file = new File(['x'], 'p.png', { type: 'image/png' });
    await uploadPhoto('remembrance', file);
    expect(fetchMock.mock.calls[0]![1].headers).toBeUndefined();
  });
});

describe('postMessage', () => {
  it('sets a Bearer header when a token is provided', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => okMessage });
    vi.stubGlobal('fetch', fetchMock);
    await postMessage('remembrance', { text: 'hi' }, 'tok123');
    expect(fetchMock.mock.calls[0]![1].headers).toMatchObject({ Authorization: 'Bearer tok123' });
  });

  it('surfaces the server error string on a 401', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({ error: "This link can't be used to upload — scan the QR code at the event." }),
    });
    vi.stubGlobal('fetch', fetchMock);
    await expect(postMessage('remembrance', { text: 'hi' })).rejects.toThrow(
      "This link can't be used to upload — scan the QR code at the event.",
    );
  });
});
