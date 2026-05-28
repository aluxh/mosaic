import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import * as api from '../lib/api';
import { App } from '../App';
import type { Event } from '../types';

const remembranceEvent: Event = {
  id: 'remembrance',
  mode: 'remembrance',
  eyebrow: 'In loving memory of',
  title: 'Theodore James Halloway',
  dateline: 'June 3, 1948 — May 11, 2025',
  place: 'A service of remembrance',
  invitation: 'Share a memory.',
  brandSub: 'In remembrance · Theodore',
  shortCode: '4F8K',
};

beforeEach(() => {
  vi.spyOn(api, 'fetchEvents').mockResolvedValue([remembranceEvent]);
  vi.spyOn(api, 'fetchPhotos').mockResolvedValue([]);
  vi.spyOn(api, 'fetchMessages').mockResolvedValue([]);
});

async function renderApp() {
  const view = render(<App />);
  await waitFor(() => expect(screen.queryByText(/Loading event/i)).not.toBeInTheDocument());
  return view;
}

describe('App keyboard shortcuts', () => {
  it('opens the contribute sheet with "c"', async () => {
    await renderApp();
    expect(screen.queryByText(/leave a remembrance/i)).not.toBeInTheDocument();
    act(() => {
      fireEvent.keyDown(window, { key: 'c' });
    });
    expect(screen.getByText(/leave a remembrance/i)).toBeInTheDocument();
  });

  it('closes the contribute sheet with Escape', async () => {
    await renderApp();
    act(() => {
      fireEvent.keyDown(window, { key: 'c' });
    });
    expect(screen.getByText(/leave a remembrance/i)).toBeInTheDocument();
    act(() => {
      fireEvent.keyDown(window, { key: 'Escape' });
    });
    expect(screen.queryByText(/leave a remembrance/i)).not.toBeInTheDocument();
  });

  it('toggles paused with Space', async () => {
    await renderApp();
    const pauseBtn = screen.getByLabelText('Pause');
    expect(pauseBtn).toBeInTheDocument();
    act(() => {
      fireEvent.keyDown(window, { code: 'Space' });
    });
    expect(screen.getByLabelText('Play')).toBeInTheDocument();
  });

  it('ignores shortcuts when focus is inside an input', async () => {
    await renderApp();
    act(() => {
      fireEvent.keyDown(window, { key: 'c' });
    });
    const input = screen.getByPlaceholderText(/e\.g\. eleanor/i);
    input.focus();
    fireEvent.keyDown(input, { key: 'Escape', target: input });
    expect(screen.getByText(/leave a remembrance/i)).toBeInTheDocument();
  });

  it('pressing m does nothing', async () => {
    await renderApp();
    expect(screen.getByText('In remembrance · Theodore')).toBeInTheDocument();
    act(() => {
      fireEvent.keyDown(window, { key: 'm' });
    });
    expect(screen.getByText('In remembrance · Theodore')).toBeInTheDocument();
  });
});

describe('App renders event theme', () => {
  it('renders the event brand sub from the loaded event', async () => {
    await renderApp();
    expect(screen.getByText('In remembrance · Theodore')).toBeInTheDocument();
  });

  it('does not render a mode toggle', async () => {
    await renderApp();
    expect(screen.queryByRole('button', { name: /celebration|remembrance/i })).not.toBeInTheDocument();
  });
});
