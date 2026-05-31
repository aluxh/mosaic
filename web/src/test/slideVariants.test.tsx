import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { DuoSlide } from '../components/slides/DuoSlide';
import { TriptychSlide } from '../components/slides/TriptychSlide';
import { PolaroidSlide } from '../components/slides/PolaroidSlide';
import { HeroSlide } from '../components/slides/HeroSlide';
import type { Photo } from '../types';

function photo(id: string): Photo {
  return {
    id,
    eventId: 'ev1',
    source: 'seed',
    url: `/data/${id}.jpg`,
    url1024: `/data/variants/${id}-1024.jpg`,
    url320: `/data/variants/${id}-320.jpg`,
    credit: 'C',
    createdAt: 0,
  };
}

const srcs = (container: HTMLElement) =>
  [...container.querySelectorAll('img')].map((i) => i.getAttribute('src'));

describe('slide variant selection', () => {
  it('DuoSlide renders the 1024 variant', () => {
    const slide = { id: 's1', type: 'duo' as const, photos: [photo('p1'), photo('p2')] as [Photo, Photo] };
    const { container } = render(<DuoSlide slide={slide} mode="celebration" durationMs={1000} />);
    expect(srcs(container)).toEqual(['/data/variants/p1-1024.jpg', '/data/variants/p2-1024.jpg']);
  });

  it('TriptychSlide renders the 1024 variant', () => {
    const slide = {
      id: 's2',
      type: 'triptych' as const,
      photos: [photo('p1'), photo('p2'), photo('p3')] as [Photo, Photo, Photo],
    };
    const { container } = render(<TriptychSlide slide={slide} durationMs={1000} />);
    expect(srcs(container)).toEqual([
      '/data/variants/p1-1024.jpg',
      '/data/variants/p2-1024.jpg',
      '/data/variants/p3-1024.jpg',
    ]);
  });

  it('PolaroidSlide renders the 320 variant', () => {
    const slide = {
      id: 's3',
      type: 'polaroid' as const,
      photos: [photo('p1'), photo('p2'), photo('p3')] as [Photo, Photo, Photo],
    };
    const { container } = render(<PolaroidSlide slide={slide} />);
    expect(srcs(container)).toEqual([
      '/data/variants/p1-320.jpg',
      '/data/variants/p2-320.jpg',
      '/data/variants/p3-320.jpg',
    ]);
  });

  it('HeroSlide still renders the original url', () => {
    const slide = { id: 's4', type: 'hero' as const, photos: [photo('p1')] as [Photo] };
    const { container } = render(<HeroSlide slide={slide} durationMs={1000} />);
    expect(srcs(container)).toEqual(['/data/p1.jpg']);
  });
});
