import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import * as api from '../lib/api';
import { RenderApp } from '../RenderApp';
import type { Event, Photo } from '../types';

const event: Event = {
  id: 'remembrance', mode: 'remembrance', eyebrow: '', title: 'T', dateline: '', place: '',
  invitation: '', brandSub: 'sub', shortCode: 'X', transitionStyle: 'default',
};
const photo = (id: string): Photo => ({
  id, eventId: 'remembrance', source: 'seed', url: `/${id}.jpg`, url1024: `/${id}.jpg`,
  url320: `/${id}.jpg`, credit: '', createdAt: 0, focalX: 0.5, focalY: 0.5,
});

beforeEach(() => {
  window.__mosaicRender = undefined;
  vi.spyOn(api, 'fetchEvents').mockResolvedValue([event]);
  vi.spyOn(api, 'fetchPhotos').mockResolvedValue([photo('a'), photo('b')]);
  vi.spyOn(api, 'fetchMessages').mockResolvedValue([]);
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('RenderApp', () => {
  it('renders slides only — no brand mark, counters, nav, or contribute chrome', async () => {
    render(<RenderApp />);
    await waitFor(() => expect(window.__mosaicRender).toBeTruthy());
    expect(screen.queryByText('Mosaic')).not.toBeInTheDocument();
    expect(screen.queryByText(/add to the wall/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/^Photos$/)).not.toBeInTheDocument();
    expect(screen.queryByText(/^Live$/)).not.toBeInTheDocument();
  });
});
