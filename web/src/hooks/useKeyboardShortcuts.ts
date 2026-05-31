import { useEffect } from 'react';

interface Handlers {
  onTogglePause: () => void;
  onOpenContribute?: () => void;
  onCloseContribute: () => void;
  onPrev: () => void;
  onNext: () => void;
}

export function useKeyboardShortcuts(handlers: Handlers) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target?.matches?.('input, textarea')) return;
      if (e.code === 'Space') {
        e.preventDefault();
        handlers.onTogglePause();
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        handlers.onPrev();
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        handlers.onNext();
      } else if (e.key === 'c' || e.key === 'C') {
        handlers.onOpenContribute?.();
      } else if (e.key === 'Escape') {
        handlers.onCloseContribute();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [handlers]);
}
