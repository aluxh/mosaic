import { useRef, useState } from 'react';
import type { AdminPhoto } from '../types';
import { clamp01, focalFromPoint, objectPositionForPhoto } from '../lib/focalPoint';

interface FocalEditorProps {
  photo: AdminPhoto;
  onSave: (focalX: number, focalY: number) => Promise<void>;
  onRecalculate: () => Promise<{ focalX: number; focalY: number }>;
  onClose: () => void;
}

const STEP = 0.02;

const PREVIEWS: { label: string; className: string }[] = [
  { label: 'Hero', className: 'aspect-video' },
  { label: 'Duo', className: 'aspect-[3/2]' },
  { label: 'Polaroid', className: 'aspect-[3/4]' },
];

const ARROWS: Record<string, [number, number]> = {
  ArrowLeft: [-STEP, 0],
  ArrowRight: [STEP, 0],
  ArrowUp: [0, -STEP],
  ArrowDown: [0, STEP],
};

export function FocalEditor({ photo, onSave, onRecalculate, onClose }: FocalEditorProps) {
  const [focalX, setFocalX] = useState(photo.focalX);
  const [focalY, setFocalY] = useState(photo.focalY);
  const [busy, setBusy] = useState(false);
  const dragging = useRef(false);
  const imageRef = useRef<HTMLDivElement>(null);

  const moveToEvent = (e: React.PointerEvent) => {
    const el = imageRef.current;
    if (!el) return;
    const { x, y } = focalFromPoint(el.getBoundingClientRect(), e.clientX, e.clientY);
    setFocalX(x);
    setFocalY(y);
  };

  const onPointerDown = (e: React.PointerEvent) => {
    dragging.current = true;
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    moveToEvent(e);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (dragging.current) moveToEvent(e);
  };
  const onPointerUp = () => {
    dragging.current = false;
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    const delta = ARROWS[e.key];
    if (!delta) return;
    e.preventDefault();
    setFocalX((x) => clamp01(x + delta[0]));
    setFocalY((y) => clamp01(y + delta[1]));
  };

  const livePosition = objectPositionForPhoto({ focalX, focalY });

  const save = async () => {
    setBusy(true);
    try {
      await onSave(focalX, focalY);
      onClose();
    } finally {
      setBusy(false);
    }
  };

  const recalc = async () => {
    setBusy(true);
    try {
      const r = await onRecalculate();
      setFocalX(r.focalX);
      setFocalY(r.focalY);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4" role="dialog" aria-label="Edit focal point">
      <div className="flex max-h-full w-full max-w-4xl flex-col gap-4 overflow-auto rounded-xl border border-neutral-800 bg-neutral-950 p-4 sm:flex-row">
        <div className="flex-1">
          <div
            ref={imageRef}
            data-testid="focal-image"
            className="relative w-full touch-none select-none overflow-hidden rounded-lg bg-neutral-900"
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
          >
            <img src={photo.url1024} alt={photo.id} className="block w-full" draggable={false} />
            <div
              role="slider"
              tabIndex={0}
              aria-label="Focal point"
              aria-valuetext={livePosition}
              onKeyDown={onKeyDown}
              className="absolute h-6 w-6 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-black/40 shadow"
              style={{ left: `${focalX * 100}%`, top: `${focalY * 100}%` }}
            />
          </div>
        </div>

        <div className="flex w-full flex-col gap-3 sm:w-56">
          {PREVIEWS.map((p) => (
            <div key={p.label}>
              <p className="mono mb-1 text-[0.6rem] uppercase tracking-wide text-neutral-400">{p.label}</p>
              <div className={`${p.className} w-full overflow-hidden rounded bg-neutral-900`}>
                <img
                  data-testid="focal-preview"
                  src={photo.url1024}
                  alt=""
                  className="h-full w-full object-cover"
                  style={{ objectPosition: livePosition }}
                />
              </div>
            </div>
          ))}

          <div className="mt-auto flex flex-col gap-2">
            <button
              type="button"
              onClick={() => {
                setFocalX(0.5);
                setFocalY(0.5);
              }}
              className="rounded border border-neutral-700 py-2 text-xs mono"
            >
              Reset to center
            </button>
            <button type="button" onClick={recalc} disabled={busy} className="rounded border border-neutral-700 py-2 text-xs mono">
              Recalculate
            </button>
            <div className="flex gap-2">
              <button type="button" onClick={onClose} className="flex-1 rounded border border-neutral-700 py-2 text-xs mono">
                Cancel
              </button>
              <button type="button" onClick={save} disabled={busy} className="flex-1 rounded bg-neutral-100 py-2 text-xs mono text-neutral-900">
                Save
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
