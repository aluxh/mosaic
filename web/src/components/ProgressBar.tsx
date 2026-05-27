import type { Mode, SlideSpec } from '../types';

interface Props {
  slideMs: number;
  idx: number;
  paused: boolean;
  total: number;
  mode: Mode;
  slide: SlideSpec;
}

function captionFor(slide: SlideSpec): string {
  switch (slide.type) {
    case 'title-card':
      return slide.event.brandSub || 'Welcome';
    case 'hero':
    case 'hero-msg':
      return `Photo · ${slide.photos[0].credit}`;
    case 'duo':
      return `Photos · ${slide.photos[0].credit} & ${slide.photos[1].credit}`;
    case 'triptych':
      return 'Three frames';
    case 'polaroid':
      return 'From the table';
    case 'message':
      return `Note · ${slide.message.name}`;
  }
}

export function ProgressBar({ slideMs, idx, paused, total, mode, slide }: Props) {
  const caption = captionFor(slide);
  return (
    <div className="absolute left-0 right-0 bottom-0 z-30 px-8 pb-7 pointer-events-none">
      <div className="flex items-center gap-4 mb-2">
        <div
          key={`cap-${idx}${mode}`}
          className="mono text-[0.62rem] tracking-[0.22em] uppercase text-white/65 flex-1 truncate anim-caption"
        >
          {caption}
        </div>
        <div className="mono text-[0.62rem] tracking-[0.22em] uppercase text-white/70">
          {String(idx + 1).padStart(2, '0')}{' '}
          <span className="opacity-50">/ {String(total).padStart(2, '0')}</span>
        </div>
      </div>
      <div className="h-px bg-white/15 relative overflow-hidden">
        <div
          key={`pf-${idx}|${mode}|${paused}`}
          className={`absolute left-0 top-0 bottom-0 bg-white/75 progress-fill ${paused ? 'paused' : ''}`}
          style={{ ['--progress-ms' as string]: `${slideMs}ms` }}
        />
      </div>
    </div>
  );
}
