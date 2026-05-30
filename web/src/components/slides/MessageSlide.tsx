import type { Mode, SlideSpec } from '../../types';

interface Props {
  slide: Extract<SlideSpec, { type: 'message' }>;
  mode: Mode;
}

export function MessageSlide({ slide, mode }: Props) {
  const msg = slide.message;
  const isCele = mode === 'celebration';

  const cardShadow = isCele
    ? '0 30px 60px -20px rgba(60,30,10,0.45), 0 8px 18px -6px rgba(60,30,10,0.25)'
    : '0 30px 60px -22px rgba(20,30,55,0.40), 0 8px 18px -6px rgba(20,30,55,0.20)';

  return (
    <div className="absolute inset-0 bg-app paper overflow-hidden">
      <div
        className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 pointer-events-none"
        style={{
          width: 'min(72vh, 620px)',
          height: 'min(72vh, 620px)',
          borderRadius: '50%',
          background: isCele
            ? 'radial-gradient(circle, oklch(0.78 0.105 82 / 0.18) 0%, transparent 65%)'
            : 'radial-gradient(circle, oklch(0.72 0.060 85 / 0.10) 0%, transparent 65%)',
        }}
      ></div>

      <div className="absolute inset-0 flex items-center justify-center px-[8vw]">
        <div
          className="relative anim-fade-up"
          style={{
            width: 'min(600px, 56vw)',
            padding: 'clamp(2.2rem, 4vw, 3.6rem) clamp(2.4rem, 4.4vw, 4rem)',
            background: isCele ? '#fffdf8' : '#fcfdff',
            boxShadow: cardShadow,
            transform: isCele ? 'rotate(-3.2deg)' : 'none',
          }}
        >
          {isCele && (
            <div
              className="absolute"
              style={{
                top: '-15px',
                left: '50%',
                width: '128px',
                height: '30px',
                transform: 'translateX(-50%) rotate(2.5deg)',
                background: 'rgba(220, 200, 150, 0.42)',
                boxShadow: '0 1px 2px rgba(0,0,0,0.08)',
              }}
            ></div>
          )}

          <div className="flex items-center justify-center gap-3 mb-7">
            <span className="w-12 h-px" style={{ background: 'var(--ink-soft)' }}></span>
            <span className="mono text-[0.7rem] tracking-[0.28em] uppercase text-ink-soft">
              {isCele ? 'A note from' : 'In memory'}
            </span>
            <span className="w-12 h-px" style={{ background: 'var(--ink-soft)' }}></span>
          </div>

          <div
            className="serif text-ink text-center"
            style={{ fontSize: 'clamp(1.6rem, 3.4vw, 3.2rem)', lineHeight: 1.12, textWrap: 'balance' }}
          >
            {isCele ? <>&ldquo;{msg.text}&rdquo;</> : msg.text}
          </div>
          <div
            className="mt-7 serif-italic text-ink-soft text-center"
            style={{ fontSize: 'clamp(1rem, 1.5vw, 1.5rem)' }}
          >
            — {msg.name}
          </div>
        </div>
      </div>
    </div>
  );
}
