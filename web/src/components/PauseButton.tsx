interface Props {
  paused: boolean;
  onToggle: () => void;
}

export function PauseButton({ paused, onToggle }: Props) {
  return (
    <button
      onClick={onToggle}
      className="w-11 h-11 rounded-full backdrop-blur-md flex items-center justify-center text-white transition hover:scale-105"
      style={{
        background: 'rgba(255,255,255,0.12)',
        border: '1px solid rgba(255,255,255,0.22)',
      }}
      aria-label={paused ? 'Play' : 'Pause'}
    >
      {paused ? (
        <svg
          key="play"
          className="icon-pop"
          width="14"
          height="14"
          viewBox="0 0 14 14"
          fill="currentColor"
        >
          <path d="M3 1.5v11l9-5.5z" />
        </svg>
      ) : (
        <svg
          key="pause"
          className="icon-pop"
          width="12"
          height="14"
          viewBox="0 0 12 14"
          fill="currentColor"
        >
          <rect x="1" y="1" width="3" height="12" rx="0.5" />
          <rect x="8" y="1" width="3" height="12" rx="0.5" />
        </svg>
      )}
    </button>
  );
}
