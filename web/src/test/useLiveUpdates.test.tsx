import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, render } from '@testing-library/react';
import { useLiveUpdates } from '../hooks/useLiveUpdates';

type Listener = () => void;

class FakeEventSource {
  static instances: FakeEventSource[] = [];
  readonly url: string;
  readonly listeners = new Map<string, Listener[]>();
  close = vi.fn();

  constructor(url: string) {
    this.url = url;
    FakeEventSource.instances.push(this);
  }

  addEventListener(type: string, listener: Listener) {
    const listeners = this.listeners.get(type) ?? [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type: string, listener: Listener) {
    const listeners = this.listeners.get(type) ?? [];
    this.listeners.set(type, listeners.filter((l) => l !== listener));
  }

  emit(type: string) {
    for (const listener of this.listeners.get(type) ?? []) listener();
  }
}

function Harness({
  eventId = 'remembrance',
  refresh,
  intervalMs = 1000,
}: {
  eventId?: string | null;
  refresh: () => void | Promise<void>;
  intervalMs?: number;
}) {
  useLiveUpdates(eventId, refresh, intervalMs);
  return null;
}

function setHidden(value: boolean) {
  Object.defineProperty(document, 'hidden', {
    configurable: true,
    value,
  });
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  FakeEventSource.instances = [];
  setHidden(false);
});

describe('useLiveUpdates', () => {
  it('opens an EventSource stream and closes it on cleanup', () => {
    vi.stubGlobal('EventSource', FakeEventSource);
    const refresh = vi.fn();

    const view = render(<Harness refresh={refresh} />);

    expect(FakeEventSource.instances).toHaveLength(1);
    expect(FakeEventSource.instances[0]!.url).toBe('/api/events/remembrance/stream');
    view.unmount();
    expect(FakeEventSource.instances[0]!.close).toHaveBeenCalledTimes(1);
  });

  it('calls refresh when a mosaic-update event arrives', () => {
    vi.stubGlobal('EventSource', FakeEventSource);
    const refresh = vi.fn();
    render(<Harness refresh={refresh} />);

    FakeEventSource.instances[0]!.emit('mosaic-update');

    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('falls back to polling when EventSource is unavailable', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('EventSource', undefined);
    const refresh = vi.fn();
    render(<Harness refresh={refresh} intervalMs={1000} />);

    expect(refresh).not.toHaveBeenCalled();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(refresh).toHaveBeenCalledTimes(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it('closes the stream and starts fallback polling after a stream error', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('EventSource', FakeEventSource);
    const refresh = vi.fn();
    render(<Harness refresh={refresh} intervalMs={1000} />);

    await act(async () => {
      FakeEventSource.instances[0]!.emit('error');
    });

    expect(FakeEventSource.instances[0]!.close).toHaveBeenCalledTimes(1);
    expect(refresh).not.toHaveBeenCalled();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(refresh).toHaveBeenCalledTimes(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it('does not poll while the document is hidden', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('EventSource', undefined);
    setHidden(true);
    const refresh = vi.fn();
    render(<Harness refresh={refresh} intervalMs={1000} />);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(refresh).not.toHaveBeenCalled();

    setHidden(false);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(refresh).toHaveBeenCalledTimes(1);
  });
});
