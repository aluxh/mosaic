import { useEffect, useMemo, useState } from 'react';
import { fetchEvents } from './lib/api';
import { fetchAdminPhotos, setPhotoHidden, deletePhoto, setTransitionStyle } from './lib/adminApi';
import { readToken } from './lib/token';
import type { AdminPhoto, Event, TransitionStyle } from './types';

export function AdminApp() {
  const token = useMemo(() => readToken() ?? undefined, []);
  const [event, setEvent] = useState<Event | null>(null);
  const [photos, setPhotos] = useState<AdminPhoto[]>([]);
  const [style, setStyle] = useState<TransitionStyle>('default');
  const [error, setError] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);

  useEffect(() => {
    document.body.classList.add('admin-scroll');
    return () => document.body.classList.remove('admin-scroll');
  }, []);

  useEffect(() => {
    if (!token) return;
    fetchEvents()
      .then((events) => {
        const ev = events[0] ?? null;
        setEvent(ev);
        if (ev) setStyle(ev.transitionStyle);
      })
      .catch((e) => setError(String(e)));
  }, [token]);

  useEffect(() => {
    if (!token || !event) return;
    fetchAdminPhotos(event.id, token)
      .then(setPhotos)
      .catch((e) => setError(e instanceof Error && /401/.test(e.message) ? "This link can't curate the wall." : String(e)));
  }, [token, event]);

  if (!token) {
    return (
      <div className="min-h-screen bg-neutral-950 text-neutral-100 flex items-center justify-center p-8">
        <p className="mono text-sm tracking-wide text-center">Open the admin link from your event setup to curate the wall.</p>
      </div>
    );
  }

  const onToggle = async (p: AdminPhoto) => {
    if (!event) return;
    const next = !p.hidden;
    setPhotos((cur) => cur.map((x) => (x.id === p.id ? { ...x, hidden: next } : x)));
    try {
      await setPhotoHidden(event.id, p.id, next, token);
    } catch {
      setPhotos((cur) => cur.map((x) => (x.id === p.id ? { ...x, hidden: p.hidden } : x))); // revert
    }
  };

  const onDelete = async (p: AdminPhoto) => {
    if (!event) return;
    if (confirmId !== p.id) {
      setConfirmId(p.id);
      return;
    }
    try {
      await deletePhoto(event.id, p.id, token);
      setPhotos((cur) => cur.filter((x) => x.id !== p.id));
    } catch (e) {
      setError(String(e));
    } finally {
      setConfirmId(null);
    }
  };

  const onStyle = async (next: TransitionStyle) => {
    if (!event) return;
    const prev = style;
    setStyle(next);
    try {
      await setTransitionStyle(event.id, next, token);
    } catch {
      setStyle(prev);
    }
  };

  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-100 p-6">
      <header className="mb-6 flex items-center justify-between gap-4">
        <h1 className="serif text-2xl">Curate the wall</h1>
        <div className="flex rounded-full border border-neutral-700 overflow-hidden mono text-xs">
          {(['default', 'cinematic'] as const).map((s) => (
            <button
              key={s}
              onClick={() => onStyle(s)}
              className={`px-4 py-2 capitalize ${style === s ? 'bg-neutral-100 text-neutral-900' : 'text-neutral-300'}`}
            >
              {s}
            </button>
          ))}
        </div>
      </header>

      {error && <p className="mb-4 text-sm text-amber-400">{error}</p>}

      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
        {photos.map((p) => (
          <div key={p.id} className={`rounded-lg overflow-hidden border border-neutral-800 ${p.hidden ? 'opacity-40' : ''}`}>
            <div className="relative aspect-square bg-neutral-900">
              <img src={p.url320} alt={p.id} className="w-full h-full object-cover" />
              <span className="absolute top-1 left-1 mono text-[0.55rem] uppercase tracking-wide px-1.5 py-0.5 rounded bg-black/60">
                {p.source === 'seed' ? 'Seed' : 'Guest'}
              </span>
              {p.hidden && (
                <span className="absolute bottom-1 left-1 mono text-[0.55rem] uppercase px-1.5 py-0.5 rounded bg-black/70">Hidden</span>
              )}
            </div>
            <div className="flex">
              <button onClick={() => onToggle(p)} className="flex-1 py-2 text-xs mono border-r border-neutral-800 hover:bg-neutral-800">
                {p.hidden ? 'Show' : 'Hide'}
              </button>
              <button
                onClick={() => onDelete(p)}
                className={`flex-1 py-2 text-xs mono hover:bg-red-900/40 ${confirmId === p.id ? 'text-red-400' : ''}`}
              >
                {confirmId === p.id ? 'Confirm delete?' : 'Delete'}
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
