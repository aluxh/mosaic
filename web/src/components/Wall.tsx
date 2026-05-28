import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import type { Event, Message, Mode, Photo, SlideSpec } from '../types';
import { buildSequence } from '../lib/buildSequence';
import { TitleCardSlide } from './slides/TitleCardSlide';
import { HeroSlide } from './slides/HeroSlide';
import { HeroWithMessageSlide } from './slides/HeroWithMessageSlide';
import { DuoSlide } from './slides/DuoSlide';
import { TriptychSlide } from './slides/TriptychSlide';
import { PolaroidSlide } from './slides/PolaroidSlide';
import { MessageSlide } from './slides/MessageSlide';
import { ProgressBar } from './ProgressBar';

export interface WallHandle {
  prev(): void;
  next(): void;
}

interface WallProps {
  photos: Photo[];
  messages: Message[];
  mode: Mode;
  paused: boolean;
  event: Event | null;
}

function SlideContent({
  slide,
  mode,
  slideMs,
}: {
  slide: SlideSpec;
  mode: Mode;
  slideMs: number;
}) {
  const dur = slideMs + 1800;
  switch (slide.type) {
    case 'title-card':
      return <TitleCardSlide slide={slide} mode={mode} />;
    case 'hero':
      return <HeroSlide slide={slide} durationMs={dur} />;
    case 'hero-msg':
      return <HeroWithMessageSlide slide={slide} mode={mode} durationMs={dur} />;
    case 'duo':
      return <DuoSlide slide={slide} mode={mode} durationMs={dur} />;
    case 'triptych':
      return <TriptychSlide slide={slide} durationMs={dur} />;
    case 'polaroid':
      return <PolaroidSlide slide={slide} />;
    case 'message':
      return <MessageSlide slide={slide} mode={mode} />;
  }
}

function SlideWrapper({
  slide,
  mode,
  slideMs,
  fadeDur,
  enterClass,
}: {
  slide: SlideSpec;
  mode: Mode;
  slideMs: number;
  fadeDur: number;
  enterClass: string;
}) {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setShown(true), 20);
    return () => clearTimeout(t);
  }, []);
  return (
    <div
      className={`absolute inset-0 ${enterClass}`}
      style={{
        opacity: shown ? 1 : 0,
        transition: `opacity ${fadeDur}ms cubic-bezier(0.22, 1, 0.36, 1)`,
      }}
    >
      <SlideContent slide={slide} mode={mode} slideMs={slideMs} />
    </div>
  );
}

export const Wall = forwardRef<WallHandle, WallProps>(function Wall(
  { photos, messages, mode, paused, event }: WallProps,
  ref,
) {
  const sequence = useMemo(
    () => buildSequence(photos, messages, mode, event),
    [photos, messages, mode, event],
  );
  const [idx, setIdx] = useState(0);

  const slideMs = mode === 'celebration' ? 4200 : 7200;
  const enterClass = mode === 'celebration' ? 'slide-cele' : 'slide-remb';
  const fadeDur = mode === 'celebration' ? 700 : 1400;

  useEffect(() => {
    setIdx(0);
  }, [mode]);

  useEffect(() => {
    if (paused || sequence.length === 0) return;
    const t = setTimeout(() => setIdx((i) => (i + 1) % sequence.length), slideMs);
    return () => clearTimeout(t);
  }, [idx, paused, sequence.length, slideMs]);

  useEffect(() => {
    if (idx >= sequence.length) setIdx(0);
  }, [sequence.length, idx]);

  useImperativeHandle(
    ref,
    () => ({
      prev() {
        if (sequence.length === 0) return;
        setIdx((i) => (i - 1 + sequence.length) % sequence.length);
      },
      next() {
        if (sequence.length === 0) return;
        setIdx((i) => (i + 1) % sequence.length);
      },
    }),
    [sequence.length],
  );

  const [prevSlide, setPrevSlide] = useState<SlideSpec | null>(null);
  const lastSlideRef = useRef<SlideSpec | null>(null);

  useEffect(() => {
    if (sequence.length === 0) return;
    const cur = sequence[idx];
    if (!cur) return;
    if (lastSlideRef.current && lastSlideRef.current.id !== cur.id) {
      setPrevSlide(lastSlideRef.current);
      const t = setTimeout(() => setPrevSlide(null), fadeDur + 80);
      lastSlideRef.current = cur;
      return () => clearTimeout(t);
    }
    lastSlideRef.current = cur;
  }, [idx, sequence, fadeDur]);

  if (sequence.length === 0) return null;
  const slide = sequence[idx]!;

  return (
    <div className="absolute inset-0 overflow-hidden vignette bg-black">
      {prevSlide && prevSlide.id !== slide.id && (
        <div className="absolute inset-0" key={`prev-${prevSlide.id}`}>
          <SlideContent slide={prevSlide} mode={mode} slideMs={slideMs} />
        </div>
      )}
      <SlideWrapper
        key={`cur-${slide.id}-${mode}`}
        slide={slide}
        mode={mode}
        slideMs={slideMs}
        fadeDur={fadeDur}
        enterClass={enterClass}
      />
      <ProgressBar
        slideMs={slideMs}
        idx={idx}
        paused={paused}
        total={sequence.length}
        mode={mode}
        slide={slide}
      />
    </div>
  );
});
