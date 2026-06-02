import { describe, it, expect } from 'vitest';
import { createRef, act } from 'react';
import { render } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { TitleCardSlide } from '../components/slides/TitleCardSlide';
import { DuoSlide } from '../components/slides/DuoSlide';
import { MessageSlide } from '../components/slides/MessageSlide';
import { Wall } from '../components/Wall';
import type { WallHandle } from '../components/Wall';
import type { Event, Photo, Message } from '../types';
import { buildSequence } from '../lib/buildSequence';

const seedEvent: Event = {
  id: 'remembrance',
  mode: 'remembrance',
  eyebrow: 'In loving memory of',
  title: 'Test Person',
  dateline: '1948 — 2025',
  place: 'A service of remembrance',
  invitation: 'Share a memory.',
  brandSub: 'In remembrance · Test',
  shortCode: '4F8K',
  transitionStyle: 'default',
};

const seedPhoto: Photo = {
  id: 'p1',
  eventId: 'remembrance',
  source: 'seed',
  url: '/data/seeds/remembrance/photo.jpg',
  url1024: '/data/variants/remembrance/photo-1024.jpg',
  url320: '/data/variants/remembrance/photo-320.jpg',
  credit: '',
  createdAt: 0,
  focalX: 0.5,
  focalY: 0.5,
};

const seedMessage: Message = {
  id: 'm1',
  eventId: 'remembrance',
  name: 'A friend',
  text: 'We will remember.',
  createdAt: 0,
  photoId: null,
};

const n1: Photo = {
  id: 'n1',
  eventId: 'remembrance',
  source: 'seed',
  url: '/p1.jpg',
  url1024: '/p1-1024.jpg',
  url320: '/p1-320.jpg',
  credit: '',
  createdAt: 0,
  focalX: 0.5,
  focalY: 0.5,
};
const n2: Photo = { ...n1, id: 'n2', url: '/p2.jpg', url1024: '/p2-1024.jpg', url320: '/p2-320.jpg' };
const n3: Photo = { ...n1, id: 'n3', url: '/p3.jpg', url1024: '/p3-1024.jpg', url320: '/p3-320.jpg' };
const navPhotos = [n1, n2, n3];

describe('paper slide CSS regression', () => {
  it('.paper rule does not override position to relative', () => {
    const css = readFileSync(resolve(__dirname, '../index.css'), 'utf8');
    // Match the .paper { ... } block (up to the first closing brace)
    const match = css.match(/\.paper\s*\{([^}]*)\}/);
    if (match) {
      expect(match[1]).not.toMatch(/position\s*:\s*relative/);
    }
    // Also assert the block exists or at minimum the rule doesn't appear anywhere
    expect(css).not.toMatch(/\.paper\s*\{[^}]*position\s*:\s*relative/);
  });

  it('TitleCardSlide root has absolute class (not relative)', () => {
    const slide = { id: 's1', type: 'title-card' as const, event: seedEvent };
    const { container } = render(<TitleCardSlide slide={slide} mode="remembrance" />);
    const root = container.firstElementChild as HTMLElement;
    expect(root.classList.contains('absolute')).toBe(true);
    expect(root.classList.contains('relative')).toBe(false);
  });

  it('DuoSlide root has absolute class (not relative)', () => {
    const slide = {
      id: 's2',
      type: 'duo' as const,
      photos: [seedPhoto, { ...seedPhoto, id: 'p2' }] as [Photo, Photo],
    };
    const { container } = render(<DuoSlide slide={slide} mode="remembrance" durationMs={7200} />);
    const root = container.firstElementChild as HTMLElement;
    expect(root.classList.contains('absolute')).toBe(true);
    expect(root.classList.contains('relative')).toBe(false);
  });

  it('MessageSlide root has absolute class (not relative)', () => {
    const slide = {
      id: 's3',
      type: 'message' as const,
      message: seedMessage,
    };
    const { container } = render(<MessageSlide slide={slide} mode="remembrance" />);
    const root = container.firstElementChild as HTMLElement;
    expect(root.classList.contains('absolute')).toBe(true);
    expect(root.classList.contains('relative')).toBe(false);
  });
});

describe('WallHandle ref navigation', () => {
  it('next() advances to the next slide', () => {
    const ref = createRef<WallHandle>();
    const { container } = render(
      <Wall
        ref={ref}
        photos={navPhotos}
        messages={[]}
        mode="remembrance"
        paused={true}
        event={seedEvent}
      />,
    );
    expect(container.textContent).toContain('01 /');
    act(() => {
      ref.current!.next();
    });
    expect(container.textContent).toContain('02 /');
  });

  it('prev() goes back, and prev() at idx 0 wraps to last', () => {
    const ref = createRef<WallHandle>();
    const { container } = render(
      <Wall
        ref={ref}
        photos={navPhotos}
        messages={[]}
        mode="remembrance"
        paused={true}
        event={seedEvent}
      />,
    );
    expect(container.textContent).toContain('01 /');
    act(() => {
      ref.current!.prev();
    });
    // Wrapped to last — no longer at 01
    expect(container.textContent).not.toContain('01 /');
  });

  it('next() at the last index wraps to index 0', () => {
    const ref = createRef<WallHandle>();
    const { container } = render(
      <Wall
        ref={ref}
        photos={navPhotos}
        messages={[]}
        mode="remembrance"
        paused={true}
        event={seedEvent}
      />,
    );
    const total = buildSequence(navPhotos, [], 'remembrance', seedEvent).length;
    // Advance to last slide
    for (let i = 0; i < total - 1; i++) {
      act(() => {
        ref.current!.next();
      });
    }
    expect(container.textContent).toContain(
      `${String(total).padStart(2, '0')} /`,
    );
    // Wrap
    act(() => {
      ref.current!.next();
    });
    expect(container.textContent).toContain('01 /');
  });

  it('with a single-slide sequence, next() and prev() leave idx at 0', () => {
    const ref = createRef<WallHandle>();
    // 1 photo + null event = exactly 1 slide (hero only, no title card)
    const { container } = render(
      <Wall
        ref={ref}
        photos={[n1]}
        messages={[]}
        mode="remembrance"
        paused={true}
        event={null}
      />,
    );
    expect(container.textContent).toContain('01 /');
    act(() => { ref.current!.next(); });
    expect(container.textContent).toContain('01 /');
    act(() => { ref.current!.prev(); });
    expect(container.textContent).toContain('01 /');
  });

  it('applies the cinematic enter class when event.transitionStyle is cinematic', () => {
    const ev = { ...seedEvent, transitionStyle: 'cinematic' as const };
    const { container } = render(
      <Wall photos={navPhotos} messages={[]} mode="remembrance" paused event={ev} />,
    );
    expect(container.querySelector('.slide-cine-remb')).toBeTruthy();
  });

  it('uses the default enter class when transitionStyle is default', () => {
    const ev = { ...seedEvent, transitionStyle: 'default' as const };
    const { container } = render(
      <Wall photos={navPhotos} messages={[]} mode="remembrance" paused event={ev} />,
    );
    expect(container.querySelector('.slide-remb')).toBeTruthy();
    expect(container.querySelector('.slide-cine-remb')).toBeFalsy();
  });

  it('prev() at last index goes to second-to-last', () => {
    const ref = createRef<WallHandle>();
    const { container } = render(
      <Wall
        ref={ref}
        photos={navPhotos}
        messages={[]}
        mode="remembrance"
        paused={true}
        event={seedEvent}
      />,
    );
    const total = buildSequence(navPhotos, [], 'remembrance', seedEvent).length;
    // Go to last slide
    for (let i = 0; i < total - 1; i++) {
      act(() => { ref.current!.next(); });
    }
    const lastLabel = `${String(total).padStart(2, '0')} /`;
    expect(container.textContent).toContain(lastLabel);
    // Prev from last
    act(() => { ref.current!.prev(); });
    const penultLabel = `${String(total - 1).padStart(2, '0')} /`;
    expect(container.textContent).toContain(penultLabel);
  });
});
