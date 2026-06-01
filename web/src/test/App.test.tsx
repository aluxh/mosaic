import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import * as api from '../lib/api';
import { App } from '../App';
import type { Event, Photo } from '../types';

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
  transitionStyle: 'default',
};

beforeEach(() => {
  vi.spyOn(api, 'fetchEvents').mockResolvedValue([remembranceEvent]);
  vi.spyOn(api, 'fetchPhotos').mockResolvedValue([]);
  vi.spyOn(api, 'fetchMessages').mockResolvedValue([]);
});

afterEach(() => {
  window.location.hash = '';
  vi.unstubAllGlobals();
});

async function renderApp() {
  const view = render(<App />);
  await waitFor(() => expect(screen.queryByText(/Loading event/i)).not.toBeInTheDocument());
  return view;
}

describe('App keyboard shortcuts', () => {
  beforeEach(() => {
    window.location.hash = '#t=test';
  });

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

describe('App contribute gate', () => {
  it('shows the contribute button when a token is present', async () => {
    window.location.hash = '#t=test';
    await renderApp();
    expect(screen.getByText(/add to the wall/i)).toBeInTheDocument();
  });

  it('hides the contribute button when no token is present', async () => {
    window.location.hash = '';
    await renderApp();
    expect(screen.queryByText(/add to the wall/i)).not.toBeInTheDocument();
  });

  it('does not open the contribute sheet with "c" when no token is present', async () => {
    window.location.hash = '';
    await renderApp();
    act(() => {
      fireEvent.keyDown(window, { key: 'c' });
    });
    expect(screen.queryByText(/leave a remembrance/i)).not.toBeInTheDocument();
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

const navPhotos: Photo[] = [
  { id: 'n1', eventId: 'remembrance', source: 'seed', url: '/n1.jpg', url1024: '/n1-1024.jpg', url320: '/n1-320.jpg', credit: '', createdAt: 0 },
  { id: 'n2', eventId: 'remembrance', source: 'seed', url: '/n2.jpg', url1024: '/n2-1024.jpg', url320: '/n2-320.jpg', credit: '', createdAt: 0 },
  { id: 'n3', eventId: 'remembrance', source: 'seed', url: '/n3.jpg', url1024: '/n3-1024.jpg', url320: '/n3-320.jpg', credit: '', createdAt: 0 },
];

class FakeEventSource {
  static instances: FakeEventSource[] = [];
  readonly url: string;
  readonly listeners = new Map<string, Array<() => void>>();
  close = vi.fn();

  constructor(url: string) {
    this.url = url;
    FakeEventSource.instances.push(this);
  }

  addEventListener(type: string, listener: () => void) {
    const listeners = this.listeners.get(type) ?? [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type: string, listener: () => void) {
    const listeners = this.listeners.get(type) ?? [];
    this.listeners.set(type, listeners.filter((l) => l !== listener));
  }

  emit(type: string) {
    for (const listener of this.listeners.get(type) ?? []) listener();
  }
}

describe('App live updates', () => {
  beforeEach(() => {
    FakeEventSource.instances = [];
    vi.stubGlobal('EventSource', FakeEventSource);
  });

  it('opens a live-update stream and refreshes counters on update', async () => {
    const livePhoto: Photo = {
      id: 'live-1',
      eventId: 'remembrance',
      source: 'upload',
      url: '/live-1.jpg',
      url1024: '/live-1-1024.jpg',
      url320: '/live-1-320.jpg',
      credit: 'Maya',
      createdAt: 5,
    };
    vi.spyOn(api, 'fetchPhotos')
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([livePhoto]);

    const { container } = await renderApp();
    await waitFor(() => expect(api.fetchPhotos).toHaveBeenCalledTimes(1));
    expect(FakeEventSource.instances[0]!.url).toBe('/api/events/remembrance/stream');

    act(() => {
      FakeEventSource.instances[0]!.emit('mosaic-update');
    });

    await waitFor(() => expect(api.fetchPhotos).toHaveBeenCalledTimes(2));
    expect(container.textContent).toContain('1Photos');
  });
});

describe('App arrow key navigation', () => {
  beforeEach(() => {
    vi.spyOn(api, 'fetchPhotos').mockResolvedValue(navPhotos);
  });

  it('ArrowRight advances the slide index', async () => {
    const { container } = await renderApp();
    await waitFor(() => expect(container.textContent).toContain('01 /'));
    act(() => {
      fireEvent.keyDown(window, { key: 'ArrowRight' });
    });
    expect(container.textContent).toContain('02 /');
  });

  it('ArrowLeft from slide 0 wraps to the last slide', async () => {
    const { container } = await renderApp();
    await waitFor(() => expect(container.textContent).toContain('01 /'));
    act(() => {
      fireEvent.keyDown(window, { key: 'ArrowLeft' });
    });
    expect(container.textContent).not.toContain('01 /');
  });

  it('ArrowRight does not toggle paused', async () => {
    await renderApp();
    expect(screen.getByLabelText('Pause')).toBeInTheDocument();
    act(() => {
      fireEvent.keyDown(window, { key: 'ArrowRight' });
    });
    expect(screen.getByLabelText('Pause')).toBeInTheDocument();
  });

  it('ArrowRight ignored when an input is focused', async () => {
    window.location.hash = '#t=test';
    const { container } = await renderApp();
    act(() => {
      fireEvent.keyDown(window, { key: 'c' });
    });
    const input = screen.getByPlaceholderText(/e\.g\. eleanor/i);
    input.focus();
    const textBefore = container.textContent;
    fireEvent.keyDown(input, { key: 'ArrowRight', target: input });
    expect(container.textContent).toBe(textBefore);
  });
});
