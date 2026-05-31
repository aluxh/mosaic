import type { Mode, SlideSpec } from '../../types';
import { hash01 } from '../../lib/hash';
import { KenBurns } from './KenBurns';

interface Props {
  slide: Extract<SlideSpec, { type: 'duo' }>;
  mode: Mode;
  durationMs: number;
}

export function DuoSlide({ slide, mode, durationMs }: Props) {
  const [a, b] = slide.photos;
  const isCele = mode === 'celebration';
  const flip = hash01(slide.id, 9) > 0.5;
  const wideLeft = !flip;
  return (
    <div className="absolute inset-0 bg-app paper overflow-hidden">
      <div
        className="absolute inset-0 grid"
        style={{
          gridTemplateColumns: wideLeft ? '62% 38%' : '38% 62%',
          gap: isCele ? '1.5vw' : '2vw',
          padding: isCele ? '4vh 4vw' : '6vh 6vw',
        }}
      >
        <div
          className="relative overflow-hidden anim-from-left"
          style={{ borderRadius: isCele ? 4 : 2 }}
        >
          <KenBurns src={a.url1024} seed={`${slide.id}-a`} durationMs={durationMs} />
        </div>
        <div
          className="relative overflow-hidden anim-from-right anim-delay-1"
          style={{ borderRadius: isCele ? 4 : 2 }}
        >
          <KenBurns src={b.url1024} seed={`${slide.id}-b`} durationMs={durationMs} />
        </div>
      </div>
    </div>
  );
}
