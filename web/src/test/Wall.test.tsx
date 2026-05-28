import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { TitleCardSlide } from '../components/slides/TitleCardSlide';
import { DuoSlide } from '../components/slides/DuoSlide';
import { MessageSlide } from '../components/slides/MessageSlide';
import type { Event, Photo, Message } from '../types';

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
};

const seedPhoto: Photo = {
  id: 'p1',
  eventId: 'remembrance',
  source: 'seed',
  url: '/data/seeds/remembrance/photo.jpg',
  credit: '',
  createdAt: 0,
};

const seedMessage: Message = {
  id: 'm1',
  eventId: 'remembrance',
  name: 'A friend',
  text: 'We will remember.',
  createdAt: 0,
};

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
      photo: seedPhoto,
    };
    const { container } = render(<MessageSlide slide={slide} mode="remembrance" />);
    const root = container.firstElementChild as HTMLElement;
    expect(root.classList.contains('absolute')).toBe(true);
    expect(root.classList.contains('relative')).toBe(false);
  });
});
