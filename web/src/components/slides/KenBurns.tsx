import { pickKenVariant } from '../../lib/hash';

interface KenBurnsProps {
  src: string;
  alt?: string;
  durationMs?: number;
  seed?: string;
  extraClass?: string;
}

export function KenBurns({
  src,
  alt = '',
  durationMs = 7000,
  seed = 'k',
  extraClass = '',
}: KenBurnsProps) {
  const kenClass = pickKenVariant(seed);
  return (
    <img
      src={src}
      alt={alt}
      draggable={false}
      className={`absolute inset-0 w-full h-full select-none ${kenClass} ${extraClass}`}
      style={{
        objectFit: 'cover',
        willChange: 'transform',
        ['--ken-ms' as string]: `${durationMs}ms`,
      }}
    />
  );
}
