import { useEffect, useRef, useState } from 'react';
import type { Mode } from '../types';

export interface ContributeSubmission {
  name: string;
  message: string;
  file: File | null;
  previewUrl: string | null;
}

interface Props {
  open: boolean;
  mode: Mode;
  onClose: () => void;
  onSubmit: (submission: ContributeSubmission) => Promise<void> | void;
}

export function ContributeSheet({ open, mode, onClose, onSubmit }: Props) {
  const isCele = mode === 'celebration';
  const [name, setName] = useState('');
  const [message, setMessage] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (open) return;
    const t = setTimeout(() => {
      setName('');
      setMessage('');
      setFile(null);
      setPreview(null);
      setSuccess(false);
      setSubmitting(false);
    }, 500);
    return () => clearTimeout(t);
  }, [open]);

  if (!open) return null;

  const handleFile = (f: File | null | undefined) => {
    if (!f) return;
    setFile(f);
    setPreview(URL.createObjectURL(f));
  };

  const onDrop: React.DragEventHandler<HTMLDivElement> = (e) => {
    e.preventDefault();
    const f = e.dataTransfer.files?.[0];
    if (f && f.type.startsWith('image/')) handleFile(f);
  };

  const canSubmit = (file !== null || message.trim().length > 0) && !submitting;

  const submit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      await onSubmit({
        name: name.trim(),
        message: message.trim(),
        file,
        previewUrl: preview,
      });
      setSuccess(true);
      await new Promise((r) => setTimeout(r, 1100));
      onClose();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center">
      <div className="absolute inset-0 bg-black/55 backdrop-blur-sm" onClick={onClose}></div>
      <div
        className="relative w-full md:max-w-[520px] md:rounded-2xl rounded-t-3xl overflow-y-auto bg-app paper text-ink shadow-2xl sheet-mount no-scrollbar"
        style={{ maxHeight: '92vh' }}
      >
        <div className="px-7 pt-7 pb-3 flex items-start justify-between">
          <div>
            <div className="mono text-[0.65rem] tracking-[0.28em] uppercase text-ink-soft mb-1.5">
              {isCele ? 'Add to the wall' : 'Leave a remembrance'}
            </div>
            <div
              className="serif text-ink"
              style={{ fontSize: '1.65rem', lineHeight: 1.1, textWrap: 'balance' }}
            >
              {isCele ? (
                <>
                  A photo, <em className="serif-italic">a note</em>, a memory.
                </>
              ) : (
                <>Share a memory you carry.</>
              )}
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-9 h-9 rounded-full border border-line flex items-center justify-center text-ink-soft hover:text-ink hover:border-ink transition flex-shrink-0"
            aria-label="Close"
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 14 14"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.4"
              strokeLinecap="round"
            >
              <path d="M2 2l10 10M12 2L2 12" />
            </svg>
          </button>
        </div>

        <div className="px-7 pb-7 space-y-4">
          <div>
            <label className="mono text-[0.65rem] tracking-[0.22em] uppercase text-ink-soft block mb-1.5">
              Photo
            </label>
            <div
              onClick={() => fileRef.current?.click()}
              onDragOver={(e) => e.preventDefault()}
              onDrop={onDrop}
              className="relative border border-dashed border-line rounded-lg overflow-hidden cursor-pointer transition hover:border-ink/60"
              style={{ aspectRatio: '2.4/1' }}
            >
              {preview ? (
                <>
                  <img
                    src={preview}
                    alt=""
                    className="absolute inset-0 w-full h-full"
                    style={{ objectFit: 'cover' }}
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-black/55 via-transparent to-transparent" />
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setFile(null);
                      setPreview(null);
                    }}
                    className="absolute top-2 right-2 mono text-[0.62rem] tracking-[0.18em] uppercase bg-white/95 text-black/80 px-2 py-1 rounded hover:bg-white"
                  >
                    Replace
                  </button>
                  <div className="absolute left-3 bottom-3 mono text-[0.62rem] tracking-[0.18em] uppercase text-white/90">
                    {file?.name || 'preview'}
                  </div>
                </>
              ) : (
                <div className="absolute inset-0 flex items-center justify-center gap-3 text-ink-soft">
                  <div className="w-10 h-10 rounded-full border border-line flex items-center justify-center flex-shrink-0">
                    <svg
                      width="16"
                      height="16"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.4"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <rect x="3" y="5" width="18" height="14" rx="1" />
                      <circle cx="9" cy="11" r="2" />
                      <path d="M3 17l5-5 4 4 3-3 6 6" />
                    </svg>
                  </div>
                  <div className="text-left">
                    <div className="serif text-ink text-base leading-tight whitespace-nowrap">
                      Tap to add a photo
                    </div>
                    <div className="mono text-[0.6rem] tracking-[0.18em] uppercase text-ink-soft mt-0.5 whitespace-nowrap">
                      or drop a file here
                    </div>
                  </div>
                </div>
              )}
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                onChange={(e) => handleFile(e.target.files?.[0] ?? null)}
              />
            </div>
          </div>

          <div>
            <label className="mono text-[0.65rem] tracking-[0.22em] uppercase text-ink-soft block mb-1.5">
              Your name
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={isCele ? 'e.g. Maya' : 'e.g. Eleanor'}
              className="w-full bg-transparent border-b border-line focus:border-ink outline-none py-1.5 serif text-ink placeholder:text-ink-soft/60 transition"
              style={{ fontSize: '1.2rem' }}
            />
          </div>

          <div>
            <label className="mono text-[0.65rem] tracking-[0.22em] uppercase text-ink-soft block mb-1.5">
              {isCele ? 'Your message (optional)' : 'A memory or note'}
            </label>
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              rows={2}
              maxLength={240}
              placeholder={
                isCele
                  ? 'Say something they’ll read in 50 years.'
                  : 'A moment, a phrase, a thank you.'
              }
              className="w-full bg-transparent border border-line focus:border-ink outline-none p-2.5 rounded serif text-ink placeholder:text-ink-soft/60 transition resize-none"
              style={{ fontSize: '1rem', lineHeight: 1.4 }}
            />
            <div className="mono text-[0.6rem] tracking-[0.18em] uppercase text-ink-soft mt-1 text-right">
              {message.length} / 240
            </div>
          </div>

          <button
            disabled={!canSubmit}
            onClick={submit}
            className="w-full relative overflow-hidden py-3.5 rounded-full transition disabled:opacity-40 disabled:cursor-not-allowed hover:scale-[1.01] active:scale-[0.99]"
            style={{ background: 'var(--ink)', color: 'var(--bg)' }}
          >
            <span className="mono text-[0.7rem] tracking-[0.28em] uppercase">
              {success
                ? 'Added to the wall'
                : submitting
                  ? 'Sharing…'
                  : isCele
                    ? 'Share with the wall'
                    : 'Add to the remembrance'}
            </span>
          </button>

          <div className="text-center mono text-[0.6rem] tracking-[0.2em] uppercase text-ink-soft">
            Visible on the main display moments after you share
          </div>
        </div>
      </div>
    </div>
  );
}
