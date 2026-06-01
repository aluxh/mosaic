import { afterEach, describe, expect, it, vi } from 'vitest';
import { uploadPhoto, postMessage, fetchPhotos, fetchEvents } from '../lib/api';

const okPhoto = {
  id: 'p1',
  event_id: 'remembrance',
  source: 'upload',
  url: '/data/uploads/remembrance/p1.png',
  url_1024: '/data/variants/remembrance/p1-1024.png',
  url_320: '/data/variants/remembrance/p1-320.png',
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

describe('fetchPhotos', () => {
  it('maps url_1024 and url_320 to url1024 and url320', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => [
        {
          id: 'p1',
          event_id: 'remembrance',
          source: 'seed',
          url: '/data/seeds/remembrance/p1.jpg',
          url_1024: '/data/variants/remembrance/p1-1024.jpg',
          url_320: '/data/variants/remembrance/p1-320.jpg',
          credit: 'Maya',
          created_at: 5,
        },
      ],
    });
    vi.stubGlobal('fetch', fetchMock);
    const photos = await fetchPhotos('remembrance');
    expect(photos[0]!.url1024).toBe('/data/variants/remembrance/p1-1024.jpg');
    expect(photos[0]!.url320).toBe('/data/variants/remembrance/p1-320.jpg');
    expect(photos[0]!.url).toBe('/data/seeds/remembrance/p1.jpg');
  });
});

describe('fetchEvents', () => {
  it('maps transition_style to transitionStyle', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => [{
        id: 'e1', mode: 'remembrance', eyebrow: '', title: '', dateline: '', place: '',
        invitation: '', brand_sub: '', short_code: 'X', transition_style: 'cinematic',
      }],
    })) as unknown as typeof fetch);
    const [ev] = await fetchEvents();
    expect(ev.transitionStyle).toBe('cinematic');
  });
});
