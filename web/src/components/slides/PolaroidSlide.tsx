import type { SlideSpec } from '../../types';

interface Props {
  slide: Extract<SlideSpec, { type: 'polaroid' }>;
}

const POSITIONS = [
  { x: '-14%', y: '-4%', r: -7 },
  { x: '6%', y: '6%', r: 4 },
  { x: '22%', y: '-10%', r: 9 },
] as const;

export function PolaroidSlide({ slide }: Props) {
  return (
    <div className="absolute inset-0 bg-app paper overflow-hidden">
      <div className="absolute inset-0 flex items-center justify-center">
        <div className="relative" style={{ width: 'min(72vw, 1000px)', height: 'min(60vh, 600px)' }}>
          {slide.photos.map((p, i) => {
            const pos = POSITIONS[i]!;
            const fromT = `translate(calc(-50% + ${pos.x}), calc(-50% + ${pos.y})) rotate(${pos.r - 6}deg) scale(0.92)`;
            const toT = `translate(calc(-50% + ${pos.x}), calc(-50% + ${pos.y})) rotate(${pos.r}deg) scale(1)`;
            return (
              <div
                key={p.id}
                className={`absolute left-1/2 top-1/2 polaroid-in ${
                  i === 1 ? 'anim-delay-1' : i === 2 ? 'anim-delay-2' : ''
                }`}
                style={{
                  width: '38%',
                  aspectRatio: '4/5',
                  transform: toT,
                  ['--p-from' as string]: fromT,
                  ['--p-to' as string]: toT,
                }}
              >
                <div className="w-full h-full bg-white p-[6%] pb-[14%] shadow-[0_30px_60px_-20px_rgba(60,30,10,0.45),0_8px_18px_-6px_rgba(60,30,10,0.25)]">
                  <div className="relative w-full h-full overflow-hidden bg-neutral-200">
                    <img
                      src={p.url}
                      alt=""
                      className="absolute inset-0 w-full h-full"
                      style={{ objectFit: 'cover' }}
                      draggable={false}
                    />
                  </div>
                  <div
                    className="mt-2 text-center serif-italic text-neutral-700"
                    style={{ fontSize: '0.95vw' }}
                  >
                    {p.credit}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
