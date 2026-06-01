import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Wall, type WallHandle } from './components/Wall';
import { Counter } from './components/Counter';
import { PauseButton } from './components/PauseButton';
import { NavButton } from './components/NavButton';
import { ContributeSheet, type ContributeSubmission } from './components/ContributeSheet';
import { JustAddedTicker, type TickerEntry } from './components/JustAddedTicker';
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts';
import { useIdleChrome } from './hooks/useIdleChrome';
import { useLiveUpdates } from './hooks/useLiveUpdates';
import {
  fetchEvents,
  fetchMessages,
  fetchPhotos,
  postMessage,
  uploadPhoto,
} from './lib/api';
import { readToken } from './lib/token';
import type { Event, Message, Photo } from './types';

const POLL_MS = 10_000;

export function App() {
  const [events, setEvents] = useState<Event[]>([]);
  const [photosByEvent, setPhotosByEvent] = useState<Record<string, Photo[]>>({});
  const [messagesByEvent, setMessagesByEvent] = useState<Record<string, Message[]>>({});
  const [paused, setPaused] = useState(false);
  const [contributeOpen, setContributeOpen] = useState(false);
  const [tickerEntry, setTickerEntry] = useState<TickerEntry | null>(null);
  const chromeAwake = useIdleChrome();
  const wallRef = useRef<WallHandle>(null);
  const onPrev = () => wallRef.current?.prev();
  const onNext = () => wallRef.current?.next();

  const event = useMemo(() => events[0] ?? null, [events]);
  const token = useMemo(() => readToken() ?? undefined, []);
  const canContribute = Boolean(token);

  useEffect(() => {
    fetchEvents().then(setEvents).catch(console.error);
  }, []);

  const refresh = useCallback(async () => {
    if (!event) return;
    const [p, m] = await Promise.all([fetchPhotos(event.id), fetchMessages(event.id)]);
    setPhotosByEvent((prev) => ({ ...prev, [event.id]: p }));
    setMessagesByEvent((prev) => ({ ...prev, [event.id]: m }));
  }, [event]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useLiveUpdates(event?.id, refresh, POLL_MS);

  useKeyboardShortcuts({
    onTogglePause: () => setPaused((p) => !p),
    onOpenContribute: canContribute ? () => setContributeOpen(true) : undefined,
    onCloseContribute: () => setContributeOpen(false),
    onPrev,
    onNext,
  });

  const photos = event ? (photosByEvent[event.id] ?? []) : [];
  const messages = event ? (messagesByEvent[event.id] ?? []) : [];

  const handleSubmit = async (s: ContributeSubmission) => {
    if (!event) return;
    let uploaded: Photo | null = null;
    if (s.file) {
      const { photo, message } = await uploadPhoto(
        event.id,
        s.file,
        s.name || undefined,
        s.message || undefined,
        token,
      );
      uploaded = photo;
      setPhotosByEvent((prev) => ({
        ...prev,
        [event.id]: [...(prev[event.id] ?? []), photo],
      }));
      if (message) {
        setMessagesByEvent((prev) => ({
          ...prev,
          [event.id]: [...(prev[event.id] ?? []), message],
        }));
      }
    } else if (s.message) {
      const m = await postMessage(
        event.id,
        { name: s.name || undefined, text: s.message },
        token,
      );
      setMessagesByEvent((prev) => ({
        ...prev,
        [event.id]: [...(prev[event.id] ?? []), m],
      }));
    }
    const id = `tick-${Date.now()}`;
    setTickerEntry({
      id,
      name: s.name || 'A friend',
      photoUrl: uploaded?.url ?? s.previewUrl,
    });
    setTimeout(() => {
      setTickerEntry((cur) => (cur && cur.id === id ? null : cur));
    }, 4500);
  };

  const navHidden = !paused && !chromeAwake;

  const chromeStyle: React.CSSProperties = {
    transition:
      'opacity 450ms cubic-bezier(0.22, 1, 0.36, 1), transform 450ms cubic-bezier(0.22, 1, 0.36, 1)',
    opacity: chromeAwake ? 1 : 0.55,
  };

  if (!event) {
    return (
      <div className="fixed inset-0 mode-remembrance bg-app text-ink flex items-center justify-center">
        <div className="text-center">
          <div className="serif text-4xl mb-3">Mosaic</div>
          <div className="mono text-xs tracking-[0.28em] uppercase text-ink-soft">
            Loading event…
          </div>
        </div>
      </div>
    );
  }

  const mode = event.mode;

  return (
    <div className={`fixed inset-0 ${mode === 'celebration' ? 'mode-celebration' : 'mode-remembrance'}`}>
      <Wall ref={wallRef} photos={photos} messages={messages} mode={mode} paused={paused} event={event} />

      <div
        className="fixed inset-x-0 top-0 z-20 pointer-events-none"
        style={{
          height: 130,
          background: 'linear-gradient(180deg, rgba(0,0,0,0.4) 0%, rgba(0,0,0,0) 100%)',
        }}
      ></div>
      <div
        className="fixed inset-x-0 bottom-0 z-20 pointer-events-none"
        style={{
          height: 220,
          background: 'linear-gradient(0deg, rgba(0,0,0,0.55) 0%, rgba(0,0,0,0) 100%)',
        }}
      ></div>

      <JustAddedTicker entry={tickerEntry} mode={mode} />

      <div
        className="fixed left-7 top-6 z-30 flex items-center gap-3 pointer-events-none"
        style={chromeStyle}
      >
        <div
          className="w-7 h-7 rounded-full"
          style={{
            background: 'conic-gradient(from 215deg, var(--accent), var(--gold), var(--accent))',
            boxShadow:
              '0 0 0 2px rgba(255,255,255,0.85), 0 8px 24px -8px rgba(0,0,0,0.35)',
          }}
        ></div>
        <div className="text-white">
          <div className="serif" style={{ fontSize: '1.2rem', lineHeight: 1 }}>
            Mosaic
          </div>
          <div className="mono text-[0.55rem] tracking-[0.3em] uppercase opacity-70 mt-1">
            {event.brandSub}
          </div>
        </div>
      </div>

      <div
        className="fixed right-7 top-6 z-30 flex items-center gap-6 pointer-events-none text-white/85"
        style={chromeStyle}
      >
        <Counter value={photos.length} label="Photos" />
        <Counter value={messages.length} label="Notes" />
        <span className="hidden md:flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
          <span className="mono text-[0.62rem] tracking-[0.24em] uppercase">Live</span>
        </span>
      </div>

      {canContribute && (
        <button
          onClick={() => setContributeOpen(true)}
          className="fixed left-7 bottom-20 z-30 group flex items-center gap-3 pl-2 pr-5 py-2 rounded-full backdrop-blur-md hover:scale-[1.02] active:scale-[0.98]"
          style={{
            ...chromeStyle,
            background: 'rgba(255,255,255,0.12)',
            border: '1px solid rgba(255,255,255,0.25)',
            transition:
              'opacity 450ms cubic-bezier(0.22, 1, 0.36, 1), transform 250ms cubic-bezier(0.22, 1, 0.36, 1), background 200ms',
          }}
        >
          <span
            className="w-9 h-9 rounded-full flex items-center justify-center text-white"
            style={{ background: 'var(--accent)' }}
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
            >
              <path d="M8 3v10M3 8h10" />
            </svg>
          </span>
          <span className="text-white text-left">
            <span className="block serif text-lg leading-none">Add to the wall</span>
            <span className="block mono text-[0.58rem] tracking-[0.24em] uppercase opacity-75 mt-1">
              mosaic.live / {event.shortCode}
            </span>
          </span>
        </button>
      )}

      <div className="fixed right-7 bottom-20 z-30 flex items-center gap-3" style={chromeStyle}>
        <NavButton direction="prev" onClick={onPrev} hidden={navHidden} />
        <PauseButton paused={paused} onToggle={() => setPaused((p) => !p)} />
        <NavButton direction="next" onClick={onNext} hidden={navHidden} />
      </div>

      <ContributeSheet
        open={contributeOpen}
        mode={mode}
        onClose={() => setContributeOpen(false)}
        onSubmit={handleSubmit}
      />
    </div>
  );
}
