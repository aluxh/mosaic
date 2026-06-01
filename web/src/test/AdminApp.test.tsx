import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import * as api from '../lib/api';
import * as adminApi from '../lib/adminApi';
import { AdminApp } from '../AdminApp';
import type { AdminPhoto, Event } from '../types';

const event: Event = {
  id: 'remembrance', mode: 'remembrance', eyebrow: '', title: 'T', dateline: '', place: '',
  invitation: '', brandSub: '', shortCode: 'X', transitionStyle: 'default',
};

const photo = (id: string, hidden = false): AdminPhoto => ({
  id, eventId: 'remembrance', source: 'seed', url: `/${id}.jpg`,
  url1024: `/${id}-1024.jpg`, url320: `/${id}-320.jpg`, credit: 'C', createdAt: 0, hidden,
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
