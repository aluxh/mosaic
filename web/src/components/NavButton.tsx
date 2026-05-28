interface Props {
  direction: 'prev' | 'next';
  onClick: () => void;
  hidden: boolean;
}

export function NavButton({ direction, onClick, hidden }: Props) {
  return (
    <button
      onClick={onClick}
      className="w-11 h-11 rounded-full backdrop-blur-md flex items-center justify-center text-white hover:scale-105"
      style={{
        background: 'rgba(255,255,255,0.12)',
        border: '1px solid rgba(255,255,255,0.22)',
        opacity: hidden ? 0 : 1,
        pointerEvents: hidden ? 'none' : 'auto',
        transition: 'opacity 450ms cubic-bezier(0.22, 1, 0.36, 1), transform 250ms cubic-bezier(0.22, 1, 0.36, 1)',
      }}
      aria-label={direction === 'prev' ? 'Previous slide' : 'Next slide'}
    >
      {direction === 'prev' ? (
        <svg width="12" height="14" viewBox="0 0 12 14" fill="currentColor">
          <path d="M9.5 1.5 L4 7 L9.5 12.5 L9.5 11 L5.5 7 L9.5 3 Z" />
        </svg>
      ) : (
        <svg width="12" height="14" viewBox="0 0 12 14" fill="currentColor">
          <path d="M2.5 1.5 L8 7 L2.5 12.5 L2.5 11 L6.5 7 L2.5 3 Z" />
        </svg>
      )}
    </button>
  );
}
