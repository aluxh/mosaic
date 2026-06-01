import { useEffect, useRef } from 'react';

export function useLiveUpdates(
  eventId: string | null | undefined,
  refresh: () => void | Promise<void>,
  fallbackIntervalMs: number,
) {
  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;

  useEffect(() => {
    if (!eventId) return;

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let fallbackStarted = false;
    let source: EventSource | undefined;

    const tick = async () => {
      if (cancelled) return;
      if (!document.hidden) {
        await refreshRef.current();
      }
      if (cancelled) return;
      timer = setTimeout(tick, fallbackIntervalMs);
    };

    const startFallback = () => {
      if (cancelled || fallbackStarted) return;
      fallbackStarted = true;
      timer = setTimeout(tick, fallbackIntervalMs);
    };

    const onUpdate = () => {
      void refreshRef.current();
    };

    const onError = () => {
      source?.removeEventListener('mosaic-update', onUpdate);
      source?.removeEventListener('error', onError);
      source?.close();
      source = undefined;
      startFallback();
    };

    const EventSourceCtor = window.EventSource;
    if (typeof EventSourceCtor !== 'function') {
      startFallback();
      return () => {
        cancelled = true;
        if (timer) clearTimeout(timer);
      };
    }

    source = new EventSourceCtor(`/api/events/${eventId}/stream`);
    source.addEventListener('mosaic-update', onUpdate);
    source.addEventListener('error', onError);

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      source?.removeEventListener('mosaic-update', onUpdate);
      source?.removeEventListener('error', onError);
      source?.close();
    };
  }, [eventId, fallbackIntervalMs]);
}
