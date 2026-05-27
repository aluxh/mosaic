interface Props {
  value: number;
  label: string;
}

export function Counter({ value, label }: Props) {
  return (
    <div className="flex items-baseline gap-1.5">
      <span
        key={value}
        className="serif text-white inline-block counter-pop"
        style={{ fontSize: '1.25rem', lineHeight: 1, minWidth: '0.6em' }}
      >
        {value}
      </span>
      <span className="mono text-[0.58rem] tracking-[0.26em] uppercase opacity-75">{label}</span>
    </div>
  );
}
