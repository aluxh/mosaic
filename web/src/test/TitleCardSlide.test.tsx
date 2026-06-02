import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { TitleCardSlide } from '../components/slides/TitleCardSlide';
import type { Event } from '../types';

function makeEvent(): Event {
  return {
    id: 'ev1',
    mode: 'remembrance',
    eyebrow: 'In memory of',
    title: 'Alex Chen',
    dateline: 'June 14',
    place: 'The Ritz',
    invitation: 'Share a memory',
    brandSub: 'sub',
    shortCode: 'X1',
    transitionStyle: 'default',
  };
}

describe('TitleCardSlide', () => {
  it('renders a QR code SVG', () => {
    const slide = { id: 's1', type: 'title-card' as const, event: makeEvent() };
    const { container } = render(<TitleCardSlide slide={slide} mode="remembrance" />);
    expect(container.querySelector('svg')).not.toBeNull();
  });

  it('does not render the old shortCode hint', () => {
    const slide = { id: 's1', type: 'title-card' as const, event: makeEvent() };
    const { container } = render(<TitleCardSlide slide={slide} mode="remembrance" />);
    expect(container.textContent).not.toContain('mosaic.live');
  });
});
