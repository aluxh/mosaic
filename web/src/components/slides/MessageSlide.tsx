import type { Mode, SlideSpec } from '../../types';

interface Props {
  slide: Extract<SlideSpec, { type: 'message' }>;
  mode: Mode;
}

export function MessageSlide({ slide, mode }: Props) {
  const msg = slide.message;
  const p = slide.photo;
  const isCele = mode === 'celebration';
  return (
    <div className="absolute inset-0 bg-app paper overflow-hidden">
      <div
        className="absolute inset-0 opacity-[0.18]"
        style={{ filter: 'blur(14px) saturate(0.7)' }}
      >
        <img
          src={p.url}
          alt=""
          className="absolute inset-0 w-full h-full"
          style={{ objectFit: 'cover' }}
          draggable={false}
        />
      </div>
      <div className="absolute inset-0 bg-app" style={{ opacity: isCele ? 0.65 : 0.82 }}></div>

      <div className="absolute inset-0 flex items-center justify-center px-[8vw]">
        <div className="max-w-[78vw] text-center anim-fade-up">
          <div className="flex items-center justify-center gap-3 mb-8">
            <span className="w-12 h-px" style={{ background: 'var(--ink-soft)' }}></span>
            <span className="mono text-[0.7rem] tracking-[0.28em] uppercase text-ink-soft">
              {isCele ? 'A note from' : 'In memory'}
            </span>
            <span className="w-12 h-px" style={{ background: 'var(--ink-soft)' }}></span>
          </div>
          <div
            className="serif text-ink"
            style={{
              fontSize: 'clamp(2rem, 4.6vw, 4.8rem)',
              lineHeight: 1.1,
              textWrap: 'balance',
            }}
          >
            {isCele ? <>&ldquo;{msg.text}&rdquo;</> : msg.text}
          </div>
          <div
            className="mt-10 serif-italic text-ink-soft"
            style={{ fontSize: 'clamp(1.1rem, 1.6vw, 1.6rem)' }}
          >
            — {msg.name}
          </div>
        </div>
      </div>
    </div>
  );
}
