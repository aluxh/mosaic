import { useEffect, useState } from 'react';

const IDLE_MS = 6500;

export function useIdleChrome(): boolean {
  const [awake, setAwake] = useState(true);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const wake = () => {
      setAwake(true);
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => setAwake(false), IDLE_MS);
    };
    wake();
    window.addEventListener('mousemove', wake);
    window.addEventListener('touchstart', wake);
    window.addEventListener('keydown', wake);
    return () => {
      if (timer) clearTimeout(timer);
      window.removeEventListener('mousemove', wake);
      window.removeEventListener('touchstart', wake);
      window.removeEventListener('keydown', wake);
    };
  }, []);

  return awake;
}
