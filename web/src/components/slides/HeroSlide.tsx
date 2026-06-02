import type { SlideSpec } from '../../types';
import { objectPositionForPhoto } from '../../lib/focalPoint';
import { KenBurns } from './KenBurns';

interface Props {
  slide: Extract<SlideSpec, { type: 'hero' }>;
  durationMs: number;
}

export function HeroSlide({ slide, durationMs }: Props) {
  const p = slide.photos[0];
  return (
    <div className="absolute inset-0 overflow-hidden bg-black">
      <KenBurns src={p.url} seed={slide.id} durationMs={durationMs} objectPosition={objectPositionForPhoto(p)} />
      <div className="absolute inset-0 bg-gradient-to-t from-black/55 via-black/0 to-black/15" />
    </div>
  );
}
