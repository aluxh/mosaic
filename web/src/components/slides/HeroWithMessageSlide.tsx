import type { Mode, SlideSpec } from '../../types';
import { objectPositionForPhoto } from '../../lib/focalPoint';
import { KenBurns } from './KenBurns';

interface Props {
  slide: Extract<SlideSpec, { type: 'hero-msg' }>;
  mode: Mode;
  durationMs: number;
}

export function HeroWithMessageSlide({ slide, mode, durationMs }: Props) {
  const p = slide.photos[0];
  const msg = slide.message;
  const isCele = mode === 'celebration';
  return (
    <div className="absolute inset-0 overflow-hidden bg-black">
      <KenBurns src={p.url} seed={slide.id} durationMs={durationMs} objectPosition={objectPositionForPhoto(p)} />
      <div
        className={`absolute inset-0 ${
          isCele
            ? 'bg-gradient-to-tr from-black/70 via-black/30 to-transparent'
            : 'bg-gradient-to-t from-black/80 via-black/40 to-black/10'
        }`}
      />

      {msg && (
        <div
          className={`absolute anim-from-bottom anim-delay-msg ${
            isCele
              ? 'left-[5vw] max-w-[55vw] md:max-w-[44vw]'
              : 'left-1/2 -translate-x-1/2 max-w-[70vw] text-center'
          }`}
          style={{ bottom: isCele ? 'max(20vh, 165px)' : 'max(24vh, 175px)' }}
        >
          {isCele && (
            <div className="mono text-[0.7rem] tracking-[0.22em] uppercase text-white/75 mb-3">
              <span className="inline-block w-6 h-px bg-white/60 align-middle mr-2"></span>
              From {msg.name}
            </div>
          )}
          <div
            className="serif text-white"
            style={{
              fontSize: isCele ? 'clamp(1.6rem, 3.3vw, 3.4rem)' : 'clamp(1.8rem, 3.6vw, 3.8rem)',
              lineHeight: 1.12,
              textWrap: 'balance',
              textShadow: '0 2px 30px rgba(0,0,0,0.45)',
            }}
          >
            {isCele ? <>&ldquo;{msg.text}&rdquo;</> : <>{msg.text}</>}
          </div>
          {!isCele && (
            <div className="mt-6 flex items-center justify-center gap-3 text-white/75">
              <span className="w-10 h-px bg-white/50"></span>
              <span className="serif-italic text-lg">{msg.name}</span>
              <span className="w-10 h-px bg-white/50"></span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
