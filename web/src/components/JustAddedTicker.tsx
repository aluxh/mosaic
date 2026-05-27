import { useEffect, useState } from 'react';
import type { Mode } from '../types';

export interface TickerEntry {
  id: string;
  name: string;
  photoUrl: string | null;
}

interface Props {
  entry: TickerEntry | null;
  mode: Mode;
}

export function JustAddedTicker({ entry, mode }: Props) {
  const [current, setCurrent] = useState<TickerEntry | null>(null);
  const [phase, setPhase] = useState<'in' | 'out' | 'idle'>('idle');

  useEffect(() => {
    if (!entry) return;
    setCurrent(entry);
    setPhase('in');
    const out = setTimeout(() => setPhase('out'), 3800);
    const done = setTimeout(() => {
      setPhase('idle');
      setCurrent(null);
    }, 4300);
    return () => {
      clearTimeout(out);
      clearTimeout(done);
    };
  }, [entry?.id]);

  if (!current || phase === 'idle') return null;
  const isCele = mode === 'celebration';
  return (
    <div
      className={`fixed left-1/2 top-6 z-40 pointer-events-none ${
        phase === 'in' ? 'ticker-in' : 'ticker-out'
      }`}
      style={{ transform: 'translateX(-50%)' }}
    >
      <div
        className="flex items-center gap-3 pl-2 pr-5 py-2 rounded-full backdrop-blur-md"
        style={{
          background: isCele ? 'rgba(255, 250, 240, 0.94)' : 'rgba(240, 240, 245, 0.94)',
          boxShadow:
            '0 18px 40px -16px rgba(0,0,0,0.4), 0 4px 12px -4px rgba(0,0,0,0.2)',
          border: '1px solid rgba(255,255,255,0.5)',
        }}
      >
        <div className="w-9 h-9 rounded-full overflow-hidden flex-shrink-0 bg-neutral-200">
          {current.photoUrl ? (
            <img
              src={current.photoUrl}
              alt=""
              className="w-full h-full"
              style={{ objectFit: 'cover' }}
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center serif-italic text-neutral-500">
              {current.name?.[0] || '·'}
            </div>
          )}
        </div>
        <div className="flex items-center gap-2">
          <span
            className="mono text-[0.6rem] tracking-[0.22em] uppercase"
            style={{ color: 'oklch(0.4 0.04 30)' }}
          >
            Just added
          </span>
          <span className="serif-italic text-neutral-800" style={{ fontSize: '1.05rem' }}>
            {current.name}
          </span>
        </div>
      </div>
    </div>
  );
}
