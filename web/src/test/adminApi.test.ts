import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  fetchAdminPhotos,
  setPhotoHidden,
  deletePhoto,
  setTransitionStyle,
  fetchAdminMessages,
  setMessageHidden,
  deleteMessage,
  updatePhotoFocal,
  recalculatePhotoFocal,
} from '../lib/adminApi';

afterEach(() => vi.unstubAllGlobals());

function mockFetch(impl: (url: string, init?: RequestInit) => Partial<Response>) {
  const fn = vi.fn(async (url: string, init?: RequestInit) => impl(url, init) as Response);
  vi.stubGlobal('fetch', fn as unknown as typeof fetch);
  return fn;
}

describe('adminApi', () => {
  it('fetchAdminPhotos sends the bearer token and maps rows', async () => {
    const fn = mockFetch(() => ({
      ok: true,
      json: async () => [{ id: 'p1', event_id: 'e1', source: 'seed', url: '/u', url_1024: '/a', url_320: '/b', credit: 'C', created_at: 1, hidden: 1, focal_x: 0.3, focal_y: 0.7, focal_source: 'manual' }],
    }));
    const photos = await fetchAdminPhotos('e1', 'tok');
    expect(fn).toHaveBeenCalledWith('/api/events/e1/admin/photos', expect.objectContaining({
      headers: { Authorization: 'Bearer tok' },
    }));
    expect(photos[0]).toMatchObject({ id: 'p1', hidden: true, source: 'seed', url320: '/b', focalX: 0.3, focalY: 0.7, focalSource: 'manual' });
  });

  it('setPhotoHidden PATCHes with the hidden body', async () => {
    const fn = mockFetch(() => ({ ok: true, json: async () => ({ ok: true }) }));
    await setPhotoHidden('e1', 'p1', true, 'tok');
    expect(fn).toHaveBeenCalledWith('/api/events/e1/admin/photos/p1', expect.objectContaining({
      method: 'PATCH',
      body: JSON.stringify({ hidden: true }),
    }));
  });

  it('deletePhoto DELETEs with the bearer token', async () => {
    const fn = mockFetch(() => ({ ok: true, json: async () => ({ ok: true }) }));
    await deletePhoto('e1', 'p1', 'tok');
    expect(fn).toHaveBeenCalledWith('/api/events/e1/admin/photos/p1', expect.objectContaining({ method: 'DELETE' }));
  });

  it('setTransitionStyle PATCHes settings', async () => {
    const fn = mockFetch(() => ({ ok: true, json: async () => ({ ok: true }) }));
    await setTransitionStyle('e1', 'cinematic', 'tok');
    expect(fn).toHaveBeenCalledWith('/api/events/e1/admin/settings', expect.objectContaining({
      method: 'PATCH',
      body: JSON.stringify({ transitionStyle: 'cinematic' }),
    }));
  });

  it('throws on a non-ok response', async () => {
    mockFetch(() => ({ ok: false, status: 401, json: async () => ({ error: 'nope' }) }));
    await expect(fetchAdminPhotos('e1', 'tok')).rejects.toThrow();
  });

  it('fetchAdminMessages sends the bearer token and maps rows', async () => {
    const fn = mockFetch(() => ({
      ok: true,
      json: async () => [
        { id: 'm1', event_id: 'e1', name: 'Guest', text: 'hi', created_at: 1, photo_id: null, hidden: 1 },
      ],
    }));
    const messages = await fetchAdminMessages('e1', 'tok');
    expect(fn).toHaveBeenCalledWith('/api/events/e1/admin/messages', expect.objectContaining({
      headers: { Authorization: 'Bearer tok' },
    }));
    expect(messages[0]).toMatchObject({ id: 'm1', text: 'hi', hidden: true, photoId: null });
  });

  it('setMessageHidden PATCHes with the hidden body', async () => {
    const fn = mockFetch(() => ({ ok: true, json: async () => ({ ok: true }) }));
    await setMessageHidden('e1', 'm1', true, 'tok');
    expect(fn).toHaveBeenCalledWith('/api/events/e1/admin/messages/m1', expect.objectContaining({
      method: 'PATCH',
      body: JSON.stringify({ hidden: true }),
    }));
  });

  it('deleteMessage DELETEs with the bearer token', async () => {
    const fn = mockFetch(() => ({ ok: true, json: async () => ({ ok: true }) }));
    await deleteMessage('e1', 'm1', 'tok');
    expect(fn).toHaveBeenCalledWith('/api/events/e1/admin/messages/m1', expect.objectContaining({ method: 'DELETE' }));
  });

  it('defaults a missing focal_source to unknown', async () => {
    mockFetch(() => ({
      ok: true,
      json: async () => [{ id: 'p1', event_id: 'e1', source: 'seed', url: '/u', url_1024: '/a', url_320: '/b', credit: 'C', created_at: 1, hidden: 0, focal_x: 0.5, focal_y: 0.5 }],
    }));
    const photos = await fetchAdminPhotos('e1', 'tok');
    expect(photos[0]?.focalSource).toBe('unknown');
  });

  it('updatePhotoFocal PATCHes normalized coordinates', async () => {
    const fn = mockFetch(() => ({ ok: true, json: async () => ({ ok: true }) }));
    await updatePhotoFocal('e1', 'p1', 0.42, 0.31, 'tok');
    expect(fn).toHaveBeenCalledWith('/api/events/e1/admin/photos/p1/focal', expect.objectContaining({
      method: 'PATCH',
      body: JSON.stringify({ focal_x: 0.42, focal_y: 0.31 }),
    }));
  });

  it('recalculatePhotoFocal POSTs and maps the response', async () => {
    const fn = mockFetch(() => ({ ok: true, json: async () => ({ ok: true, focal_x: 0.2, focal_y: 0.4, focal_source: 'detected' }) }));
    const result = await recalculatePhotoFocal('e1', 'p1', 'tok');
    expect(fn).toHaveBeenCalledWith('/api/events/e1/admin/photos/p1/focal/recalculate', expect.objectContaining({ method: 'POST' }));
    expect(result).toEqual({ focalX: 0.2, focalY: 0.4, focalSource: 'detected' });
  });
});
