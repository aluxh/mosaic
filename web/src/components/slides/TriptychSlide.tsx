import type { SlideSpec } from '../../types';
import { KenBurns } from './KenBurns';

interface Props {
  slide: Extract<SlideSpec, { type: 'triptych' }>;
  durationMs: number;
}

export function TriptychSlide({ slide, durationMs }: Props) {
  const [a, b, c] = slide.photos;
  return (
    <div className="absolute inset-0 bg-app paper overflow-hidden">
      <div
        className="absolute inset-0 grid"
        style={{
          gridTemplateColumns: '1fr 1.4fr 1fr',
          gridTemplateRows: '1fr',
          gap: '1.2vw',
          padding: '6vh 5vw 6vh',
        }}
      >
        {[a, b, c].map((p, i) => (
          <div
            key={p.id}
            className={`relative overflow-hidden anim-from-bottom ${
              i === 1 ? 'anim-delay-1' : i === 2 ? 'anim-delay-2' : ''
            }`}
            style={{
              alignSelf: i === 1 ? 'stretch' : i === 0 ? 'end' : 'start',
              height: i === 1 ? '100%' : '78%',
            }}
          >
            <KenBurns src={p.url} seed={`${slide.id}-${i}`} durationMs={durationMs} />
          </div>
        ))}
      </div>
    </div>
  );
}
