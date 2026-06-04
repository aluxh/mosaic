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
  renderMode?: boolean;
  // Time-scale for render-mode slow-motion capture (default 1 = real speed). All
  // motion timings are multiplied by this so a capture can run slower and be sped
  // back up for a higher effective frame rate. See the v0.9.5 spec.
  slow?: number;
}

function SlideContent({
  slide,
  mode,
  slideMs,
  slow,
}: {
  slide: SlideSpec;
  mode: Mode;
  slideMs: number;
  slow: number;
}) {
  const dur = (slideMs + 1800) * slow;
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
  enterMs,
  slow,
}: {
  slide: SlideSpec;
  mode: Mode;
  slideMs: number;
  fadeDur: number;
  enterClass: string;
  enterMs: number;
  slow: number;
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
        transition: `opacity ${fadeDur * slow}ms cubic-bezier(0.22, 1, 0.36, 1)`,
        // Scale the CSS enter animation (cinematic only) to match the slow factor.
        ...(enterMs > 0 ? { animationDuration: `${enterMs * slow}ms` } : {}),
      }}
    >
      <SlideContent slide={slide} mode={mode} slideMs={slideMs} slow={slow} />
    </div>
  );
}

export const Wall = forwardRef<WallHandle, WallProps>(function Wall(
  { photos, messages, mode, paused, event, renderMode = false, slow = 1 }: WallProps,
  ref,
) {
  const sequence = useMemo(
    () => buildSequence(photos, messages, mode, event),
    [photos, messages, mode, event],
  );
  const [idx, setIdx] = useState(0);

  const cinematic = event?.transitionStyle === 'cinematic';
  const slideMs = mode === 'celebration' ? 4200 : 7200;
  const enterClass = cinematic
    ? (mode === 'celebration' ? 'slide-cine-cele' : 'slide-cine-remb')
    : (mode === 'celebration' ? 'slide-cele' : 'slide-remb');
  const fadeDur = cinematic
    ? (mode === 'celebration' ? 600 : 1200)
    : (mode === 'celebration' ? 700 : 1400);
  // Base duration of the cinematic slide-enter CSS animation (0 = no enter anim).
  const enterMs = cinematic ? (mode === 'celebration' ? 600 : 1200) : 0;
  const RENDER_FPS = 30;

  useEffect(() => {
    setIdx(0);
  }, [mode]);

  useEffect(() => {
    if (sequence.length === 0) return;
    if (renderMode) {
      // Play once: advance to the last slide, then mark done — never wrap.
      if (idx >= sequence.length - 1) return;
      const t = setTimeout(() => setIdx((i) => i + 1), slideMs * slow);
      return () => clearTimeout(t);
    }
    if (paused) return;
    const t = setTimeout(() => setIdx((i) => (i + 1) % sequence.length), slideMs * slow);
    return () => clearTimeout(t);
  }, [idx, paused, sequence.length, slideMs, slow, renderMode]);

  useEffect(() => {
    if (!renderMode) return;
    window.__mosaicDone = false;
    if (sequence.length > 0) {
      window.__mosaicRender = { fps: RENDER_FPS, sequenceLength: sequence.length, slideMs };
      // Set a single timer to signal done after one full (slow-scaled) pass.
      const t = setTimeout(() => {
        window.__mosaicDone = true;
      }, slideMs * sequence.length * slow);
      return () => clearTimeout(t);
    }
  }, [renderMode, sequence.length, slideMs, slow]);

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
      const t = setTimeout(() => setPrevSlide(null), fadeDur * slow + 80);
      lastSlideRef.current = cur;
      return () => clearTimeout(t);
    }
    lastSlideRef.current = cur;
  }, [idx, sequence, fadeDur, slow]);

  if (sequence.length === 0) return null;
  const slide = sequence[idx]!;

  return (
    <div className="absolute inset-0 overflow-hidden vignette bg-black">
      {prevSlide && prevSlide.id !== slide.id && (
        <div className="absolute inset-0" key={`prev-${prevSlide.id}`}>
          <SlideContent slide={prevSlide} mode={mode} slideMs={slideMs} slow={slow} />
        </div>
      )}
      <SlideWrapper
        key={`cur-${slide.id}-${mode}`}
        slide={slide}
        mode={mode}
        slideMs={slideMs}
        fadeDur={fadeDur}
        enterClass={enterClass}
        enterMs={enterMs}
        slow={slow}
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
