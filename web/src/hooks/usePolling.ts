import { useEffect, useRef } from 'react';

export function usePolling(fn: () => void | Promise<void>, intervalMs: number) {
  const fnRef = useRef(fn);
  fnRef.current = fn;

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const tick = async () => {
      if (cancelled) return;
      if (!document.hidden) {
        await fnRef.current();
      }
      if (cancelled) return;
      timer = setTimeout(tick, intervalMs);
    };

    void tick();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [intervalMs]);
}
