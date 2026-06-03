import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { fetchEvents } from './lib/api';
import {
  fetchAdminPhotos,
  setPhotoHidden,
  deletePhoto,
  setTransitionStyle,
  fetchAdminMessages,
  setMessageHidden,
  deleteMessage,
  updatePhotoFocal,
  recalculatePhotoFocal,
  startExport,
  getExportStatus,
  type ExportStatus,
} from './lib/adminApi';
import { objectPositionForPhoto } from './lib/focalPoint';
import { FocalEditor } from './components/FocalEditor';
import { readToken } from './lib/token';
import type { AdminMessage, AdminPhoto, Event, TransitionStyle } from './types';

type Tab = 'photos' | 'messages';

export function AdminApp() {
  const token = useMemo(() => readToken() ?? undefined, []);
  const [event, setEvent] = useState<Event | null>(null);
  const [photos, setPhotos] = useState<AdminPhoto[]>([]);
  const [messages, setMessages] = useState<AdminMessage[]>([]);
  const [tab, setTab] = useState<Tab>('photos');
  const [style, setStyle] = useState<TransitionStyle>('default');
  const [error, setError] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [exportStatus, setExportStatus] = useState<ExportStatus | null>(null);
  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const pollExport = useCallback(() => {
    if (!event || !token) return;
    getExportStatus(event.id, token)
      .then((s) => {
        setExportStatus(s);
        if (s.status === 'running') pollRef.current = setTimeout(pollExport, 2000);
      })
      .catch((e) => setExportStatus({ status: 'error', error: String(e) }));
  }, [event, token]);

  useEffect(() => () => {
    if (pollRef.current) clearTimeout(pollRef.current);
  }, []);

  const onExport = async () => {
    if (!event || !token) return;
    try {
      const s = await startExport(event.id, token);
      setExportStatus(s);
      if (s.status === 'running') pollExport();
    } catch (e) {
      setExportStatus({ status: 'error', error: String(e) });
    }
  };

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
    const onErr = (e: unknown) =>
      setError(e instanceof Error && /401/.test(e.message) ? "This link can't curate the wall." : String(e));
    fetchAdminPhotos(event.id, token).then(setPhotos).catch(onErr);
    fetchAdminMessages(event.id, token).then(setMessages).catch(onErr);
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

  const onToggleMsg = async (m: AdminMessage) => {
    if (!event) return;
    const next = !m.hidden;
    setMessages((cur) => cur.map((x) => (x.id === m.id ? { ...x, hidden: next } : x)));
    try {
      await setMessageHidden(event.id, m.id, next, token);
    } catch {
      setMessages((cur) => cur.map((x) => (x.id === m.id ? { ...x, hidden: m.hidden } : x))); // revert
    }
  };

  const onDeleteMsg = async (m: AdminMessage) => {
    if (!event) return;
    if (confirmId !== m.id) {
      setConfirmId(m.id);
      return;
    }
    try {
      await deleteMessage(event.id, m.id, token);
      setMessages((cur) => cur.filter((x) => x.id !== m.id));
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

  const editing = photos.find((p) => p.id === editingId) ?? null;

  const onSaveFocal = async (focalX: number, focalY: number) => {
    if (!event || !editingId) return;
    await updatePhotoFocal(event.id, editingId, focalX, focalY, token);
    setPhotos((cur) =>
      cur.map((x) => (x.id === editingId ? { ...x, focalX, focalY, focalSource: 'manual' } : x)),
    );
  };

  const onRecalcFocal = async () => {
    if (!event || !editingId) return { focalX: 0.5, focalY: 0.5 };
    const r = await recalculatePhotoFocal(event.id, editingId, token);
    setPhotos((cur) =>
      cur.map((x) =>
        x.id === editingId ? { ...x, focalX: r.focalX, focalY: r.focalY, focalSource: r.focalSource } : x,
      ),
    );
    return { focalX: r.focalX, focalY: r.focalY };
  };

  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-100 p-6">
      <header className="mb-6 flex items-center justify-between gap-4">
        <h1 className="serif text-2xl">Curate the wall</h1>
        <div className="flex items-center gap-3">
          <button
            onClick={onExport}
            disabled={exportStatus?.status === 'running'}
            className="px-4 py-2 rounded-full border border-neutral-700 mono text-xs hover:bg-neutral-800 disabled:opacity-50"
          >
            {exportStatus?.status === 'running' ? 'Exporting…' : 'Export video'}
          </button>
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
        </div>
      </header>

      <div className="mb-6 flex w-fit rounded-full border border-neutral-700 overflow-hidden mono text-xs">
        {(['photos', 'messages'] as const).map((t) => (
          <button
            key={t}
            onClick={() => {
              setTab(t);
              setConfirmId(null);
            }}
            className={`px-4 py-2 capitalize ${tab === t ? 'bg-neutral-100 text-neutral-900' : 'text-neutral-300'}`}
          >
            {t}
          </button>
        ))}
      </div>

      {error && <p className="mb-4 text-sm text-amber-400">{error}</p>}
      {exportStatus?.status === 'running' && (
        <p className="mb-4 text-sm text-neutral-300 mono">
          Rendering video… {exportStatus.framesDone ?? 0}/{exportStatus.totalFrames ?? 0} frames
        </p>
      )}
      {exportStatus?.status === 'done' && exportStatus.outputUrl && (
        <p className="mb-4 text-sm">
          <a href={exportStatus.outputUrl} download className="text-emerald-400 underline">
            Download video
          </a>
        </p>
      )}
      {exportStatus?.status === 'error' && (
        <p className="mb-4 text-sm text-amber-400">Export failed: {exportStatus.error}</p>
      )}

      {tab === 'photos' ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
          {photos.map((p) => (
            <div key={p.id} className={`rounded-lg overflow-hidden border border-neutral-800 ${p.hidden ? 'opacity-40' : ''}`}>
              <button
                type="button"
                onClick={() => setEditingId(p.id)}
                aria-label={`Edit focal point for ${p.id}`}
                className="relative block aspect-square w-full bg-neutral-900"
              >
                <img
                  src={p.url320}
                  alt={p.id}
                  className="w-full h-full object-cover"
                  style={{ objectPosition: objectPositionForPhoto(p) }}
                />
                <span className="absolute top-1 left-1 mono text-[0.55rem] uppercase tracking-wide px-1.5 py-0.5 rounded bg-black/60">
                  {p.source === 'seed' ? 'Seed' : 'Guest'}
                </span>
                {p.hidden && (
                  <span className="absolute bottom-1 left-1 mono text-[0.55rem] uppercase px-1.5 py-0.5 rounded bg-black/70">Hidden</span>
                )}
              </button>
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
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
          {messages.map((m) => (
            <div key={m.id} className={`flex flex-col rounded-lg border border-neutral-800 ${m.hidden ? 'opacity-40' : ''}`}>
              <div className="flex-1 p-4">
                <p className="serif text-sm">{m.text}</p>
                <p className="mono text-[0.6rem] uppercase tracking-wide text-neutral-400 mt-2">— {m.name}</p>
                {m.hidden && (
                  <span className="mt-2 inline-block mono text-[0.55rem] uppercase px-1.5 py-0.5 rounded bg-black/70">Hidden</span>
                )}
              </div>
              <div className="flex border-t border-neutral-800">
                <button onClick={() => onToggleMsg(m)} className="flex-1 py-2 text-xs mono border-r border-neutral-800 hover:bg-neutral-800">
                  {m.hidden ? 'Show' : 'Hide'}
                </button>
                <button
                  onClick={() => onDeleteMsg(m)}
                  className={`flex-1 py-2 text-xs mono hover:bg-red-900/40 ${confirmId === m.id ? 'text-red-400' : ''}`}
                >
                  {confirmId === m.id ? 'Confirm delete?' : 'Delete'}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {editing && (
        <FocalEditor
          photo={editing}
          onSave={onSaveFocal}
          onRecalculate={onRecalcFocal}
          onClose={() => setEditingId(null)}
        />
      )}
    </div>
  );
}
