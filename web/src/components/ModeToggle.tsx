import type { Mode } from '../types';

interface Props {
  mode: Mode;
  onChange: (mode: Mode) => void;
}

export function ModeToggle({ mode, onChange }: Props) {
  const isCele = mode === 'celebration';
  return (
    <button
      onClick={() => onChange(isCele ? 'remembrance' : 'celebration')}
      className="relative h-11 rounded-full backdrop-blur-md overflow-hidden flex items-center"
      style={{
        background: 'rgba(255,255,255,0.12)',
        border: '1px solid rgba(255,255,255,0.22)',
        padding: '3px',
        width: 230,
      }}
      aria-label="Switch mode"
    >
      <div
        className="absolute top-[3px] bottom-[3px] rounded-full"
        style={{
          left: isCele ? 3 : 'calc(50% + 0px)',
          width: 'calc(50% - 3px)',
          background: isCele
            ? 'linear-gradient(135deg, oklch(0.62 0.155 38), oklch(0.78 0.105 82))'
            : 'linear-gradient(135deg, oklch(0.55 0.038 152), oklch(0.72 0.060 85))',
          transition:
            'left 360ms cubic-bezier(0.22, 1, 0.36, 1), background 360ms cubic-bezier(0.22, 1, 0.36, 1)',
        }}
      ></div>
      <div
        className="relative flex-1 text-center mono text-[0.6rem] tracking-[0.24em] uppercase"
        style={{
          color: isCele ? 'white' : 'rgba(255,255,255,0.72)',
          transition: 'color 240ms',
        }}
      >
        Celebration
      </div>
      <div
        className="relative flex-1 text-center mono text-[0.6rem] tracking-[0.24em] uppercase"
        style={{
          color: !isCele ? 'white' : 'rgba(255,255,255,0.72)',
          transition: 'color 240ms',
        }}
      >
        Remembrance
      </div>
    </button>
  );
}
