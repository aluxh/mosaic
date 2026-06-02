import QRCode from 'react-qr-code';
import type { Mode, SlideSpec } from '../../types';

interface Props {
  slide: Extract<SlideSpec, { type: 'title-card' }>;
  mode: Mode;
}

export function TitleCardSlide({ slide, mode }: Props) {
  const e = slide.event;
  const isCele = mode === 'celebration';
  return (
    <div className="absolute inset-0 bg-app paper overflow-hidden">
      <div
        className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 pointer-events-none"
        style={{
          width: 'min(80vh, 720px)',
          height: 'min(80vh, 720px)',
          borderRadius: '50%',
          background: isCele
            ? 'radial-gradient(circle, oklch(0.78 0.105 82 / 0.18) 0%, transparent 65%)'
            : 'radial-gradient(circle, oklch(0.72 0.060 85 / 0.10) 0%, transparent 65%)',
        }}
      ></div>

      <div className="absolute inset-0 flex items-center justify-center px-[8vw]">
        <div className="text-center max-w-[80vw]">
          <div className="flex items-center justify-center gap-4 mb-7 anim-fade-up">
            <span className="w-14 h-px" style={{ background: 'var(--ink-soft)' }}></span>
            <span className="mono text-[0.7rem] tracking-[0.32em] uppercase text-ink-soft">
              {e.eyebrow}
            </span>
            <span className="w-14 h-px" style={{ background: 'var(--ink-soft)' }}></span>
          </div>

          <div
            className={`text-ink anim-fade-up anim-delay-1 ${isCele ? 'serif-italic' : 'serif'}`}
            style={{
              fontSize: isCele ? 'clamp(2.6rem, 7vw, 6.5rem)' : 'clamp(2.4rem, 5.6vw, 5.5rem)',
              lineHeight: 1.02,
              letterSpacing: isCele ? '-0.01em' : '0.005em',
              textWrap: 'balance',
            }}
          >
            {e.title}
          </div>

          <div className="mt-7 mb-3 anim-fade-up anim-delay-2">
            <span className="mono text-[0.72rem] tracking-[0.32em] uppercase text-ink-soft">
              {e.dateline}
            </span>
          </div>

          <div className="anim-fade-up anim-delay-2">
            <span
              className="serif-italic text-ink-soft"
              style={{ fontSize: 'clamp(1rem, 1.4vw, 1.35rem)' }}
            >
              {e.place}
            </span>
          </div>

          <div className="mt-12 anim-fade-up anim-delay-3 max-w-[36ch] mx-auto">
            <span
              className="serif text-ink"
              style={{ fontSize: 'clamp(1.05rem, 1.6vw, 1.45rem)', lineHeight: 1.35 }}
            >
              {e.invitation}
            </span>
          </div>

          <div className="mt-8 flex flex-col items-center gap-2 anim-fade-up anim-delay-3">
            <div style={{ background: 'white', padding: '6px', borderRadius: '6px' }}>
              <QRCode value={`${window.location.origin}/join`} size={120} />
            </div>
            <div className="flex items-center gap-3">
              <span className="w-6 h-px" style={{ background: 'var(--ink-soft)' }}></span>
              <span className="mono text-[0.62rem] tracking-[0.28em] uppercase text-ink-soft">
                {window.location.hostname}/join
              </span>
              <span className="w-6 h-px" style={{ background: 'var(--ink-soft)' }}></span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
