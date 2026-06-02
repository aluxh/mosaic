import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import * as api from '../lib/api';
import * as adminApi from '../lib/adminApi';
import { AdminApp } from '../AdminApp';
import type { AdminMessage, AdminPhoto, Event } from '../types';

const event: Event = {
  id: 'remembrance', mode: 'remembrance', eyebrow: '', title: 'T', dateline: '', place: '',
  invitation: '', brandSub: '', shortCode: 'X', transitionStyle: 'default',
};

const photo = (id: string, hidden = false): AdminPhoto => ({
  id, eventId: 'remembrance', source: 'seed', url: `/${id}.jpg`,
  url1024: `/${id}-1024.jpg`, url320: `/${id}-320.jpg`, credit: 'C', createdAt: 0, hidden,
  focalX: 0.5, focalY: 0.5, focalSource: 'unknown',
});

const message = (id: string, hidden = false): AdminMessage => ({
  id, eventId: 'remembrance', name: 'Guest', text: `msg ${id}`, createdAt: 0, photoId: null, hidden,
});

beforeEach(() => {
  vi.spyOn(api, 'fetchEvents').mockResolvedValue([event]);
});

afterEach(() => {
  window.location.hash = '';
  vi.restoreAllMocks();
});

describe('AdminApp auth gate', () => {
  it('with no token shows the open-the-admin-link state and makes no admin calls', async () => {
    window.location.hash = '';
    const spy = vi.spyOn(adminApi, 'fetchAdminPhotos');
    render(<AdminApp />);
    expect(await screen.findByText(/open the admin link/i)).toBeInTheDocument();
    expect(spy).not.toHaveBeenCalled();
  });
});

describe('AdminApp curation', () => {
  beforeEach(() => {
    window.location.hash = '#t=admintok';
    vi.spyOn(adminApi, 'fetchAdminPhotos').mockResolvedValue([photo('p1'), photo('p2', true)]);
    vi.spyOn(adminApi, 'fetchAdminMessages').mockResolvedValue([]);
  });

  it('renders a card per photo with a Hidden marker on hidden ones', async () => {
    render(<AdminApp />);
    await waitFor(() => expect(adminApi.fetchAdminPhotos).toHaveBeenCalledWith('remembrance', 'admintok'));
    expect(screen.getAllByRole('img')).toHaveLength(2);
    expect(screen.getByText(/hidden/i)).toBeInTheDocument();
  });

  it('toggle calls setPhotoHidden with the flipped value', async () => {
    const spy = vi.spyOn(adminApi, 'setPhotoHidden').mockResolvedValue();
    render(<AdminApp />);
    await screen.findAllByRole('img');
    fireEvent.click(screen.getAllByRole('button', { name: /hide/i })[0]!);
    await waitFor(() => expect(spy).toHaveBeenCalledWith('remembrance', 'p1', true, 'admintok'));
  });

  it('delete requires a two-step confirm then calls deletePhoto and removes the card', async () => {
    const spy = vi.spyOn(adminApi, 'deletePhoto').mockResolvedValue();
    render(<AdminApp />);
    await screen.findAllByRole('img');
    fireEvent.click(screen.getAllByRole('button', { name: /^delete$/i })[0]!);
    expect(spy).not.toHaveBeenCalled(); // first click only arms the confirm
    fireEvent.click(screen.getByRole('button', { name: /confirm delete/i }));
    await waitFor(() => expect(spy).toHaveBeenCalledWith('remembrance', 'p1', 'admintok'));
    await waitFor(() => expect(screen.getAllByRole('img')).toHaveLength(1));
  });

  it('changing the transition style calls setTransitionStyle', async () => {
    const spy = vi.spyOn(adminApi, 'setTransitionStyle').mockResolvedValue();
    render(<AdminApp />);
    await screen.findAllByRole('img');
    fireEvent.click(screen.getByRole('button', { name: /cinematic/i }));
    await waitFor(() => expect(spy).toHaveBeenCalledWith('remembrance', 'cinematic', 'admintok'));
  });
});

describe('AdminApp scroll enablement', () => {
  it('adds admin-scroll to the body while mounted and removes it on unmount', () => {
    window.location.hash = '#t=admintok';
    vi.spyOn(adminApi, 'fetchAdminPhotos').mockResolvedValue([]);
    vi.spyOn(adminApi, 'fetchAdminMessages').mockResolvedValue([]);
    const { unmount } = render(<AdminApp />);
    expect(document.body.classList.contains('admin-scroll')).toBe(true);
    unmount();
    expect(document.body.classList.contains('admin-scroll')).toBe(false);
  });
});

describe('AdminApp message curation', () => {
  beforeEach(() => {
    window.location.hash = '#t=admintok';
    vi.spyOn(adminApi, 'fetchAdminPhotos').mockResolvedValue([]);
    vi.spyOn(adminApi, 'fetchAdminMessages').mockResolvedValue([message('m1'), message('m2', true)]);
  });

  it('switching to the Messages tab lists standalone messages with a Hidden marker', async () => {
    render(<AdminApp />);
    await waitFor(() => expect(adminApi.fetchAdminMessages).toHaveBeenCalledWith('remembrance', 'admintok'));
    fireEvent.click(screen.getByRole('button', { name: /messages/i }));
    expect(await screen.findByText('msg m1')).toBeInTheDocument();
    expect(screen.getByText('msg m2')).toBeInTheDocument();
    expect(screen.getByText(/hidden/i)).toBeInTheDocument();
  });

  it('message toggle calls setMessageHidden with the flipped value', async () => {
    const spy = vi.spyOn(adminApi, 'setMessageHidden').mockResolvedValue();
    render(<AdminApp />);
    await waitFor(() => expect(adminApi.fetchAdminMessages).toHaveBeenCalled());
    fireEvent.click(screen.getByRole('button', { name: /messages/i }));
    await screen.findByText('msg m1');
    fireEvent.click(screen.getAllByRole('button', { name: /^hide$/i })[0]!);
    await waitFor(() => expect(spy).toHaveBeenCalledWith('remembrance', 'm1', true, 'admintok'));
  });

  it('message delete requires a two-step confirm then calls deleteMessage and removes the card', async () => {
    const spy = vi.spyOn(adminApi, 'deleteMessage').mockResolvedValue();
    render(<AdminApp />);
    await waitFor(() => expect(adminApi.fetchAdminMessages).toHaveBeenCalled());
    fireEvent.click(screen.getByRole('button', { name: /messages/i }));
    await screen.findByText('msg m1');
    fireEvent.click(screen.getAllByRole('button', { name: /^delete$/i })[0]!);
    expect(spy).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /confirm delete/i }));
    await waitFor(() => expect(spy).toHaveBeenCalledWith('remembrance', 'm1', 'admintok'));
    await waitFor(() => expect(screen.queryByText('msg m1')).not.toBeInTheDocument());
  });
});

describe('AdminApp focal editing', () => {
  beforeEach(() => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      left: 0, top: 0, width: 100, height: 100, right: 100, bottom: 100, x: 0, y: 0, toJSON: () => ({}),
    } as DOMRect);
    window.location.hash = '#t=admintok';
    vi.spyOn(adminApi, 'fetchAdminPhotos').mockResolvedValue([
      { ...photo('p1'), focalX: 0.25, focalY: 0.75, focalSource: 'detected' },
    ]);
    vi.spyOn(adminApi, 'fetchAdminMessages').mockResolvedValue([]);
  });

  it('thumbnails crop with focal-aware object-position', async () => {
    render(<AdminApp />);
    const img = await screen.findByRole('img');
    expect(img.style.objectPosition).toBe('25% 75%');
  });

  it('clicking a photo opens the focal editor modal', async () => {
    render(<AdminApp />);
    await screen.findByRole('img');
    fireEvent.click(screen.getByRole('button', { name: /edit focal point/i }));
    expect(await screen.findByRole('dialog', { name: /edit focal point/i })).toBeInTheDocument();
  });

  it('saving the editor calls updatePhotoFocal and updates the thumbnail crop', async () => {
    const spy = vi.spyOn(adminApi, 'updatePhotoFocal').mockResolvedValue();
    render(<AdminApp />);
    await screen.findByRole('img');
    fireEvent.click(screen.getByRole('button', { name: /edit focal point/i }));
    await screen.findByRole('dialog');
    fireEvent.pointerDown(screen.getByTestId('focal-image'), { clientX: 10, clientY: 90 });
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }));
    await waitFor(() => expect(spy).toHaveBeenCalledWith('remembrance', 'p1', 0.1, 0.9, 'admintok'));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.getByRole('img').style.objectPosition).toBe('10% 90%');
  });
});
