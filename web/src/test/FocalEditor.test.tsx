import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { FocalEditor } from '../components/FocalEditor';
import type { AdminPhoto } from '../types';

const photo: AdminPhoto = {
  id: 'p1', eventId: 'e1', source: 'seed', url: '/p1.jpg', url1024: '/p1-1024.jpg',
  url320: '/p1-320.jpg', credit: 'C', createdAt: 0, hidden: false, focalX: 0.5, focalY: 0.5,
  focalSource: 'detected',
};

beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
    left: 0, top: 0, width: 100, height: 100, right: 100, bottom: 100, x: 0, y: 0, toJSON: () => ({}),
  } as DOMRect);
});

afterEach(() => vi.restoreAllMocks());

function noop() { return Promise.resolve(); }
function noRecalc() { return Promise.resolve({ focalX: 0.5, focalY: 0.5 }); }

describe('FocalEditor', () => {
  it('renders the marker at the current focal point', () => {
    render(<FocalEditor photo={photo} onSave={noop} onRecalculate={noRecalc} onClose={() => {}} />);
    const marker = screen.getByRole('slider', { name: /focal point/i });
    expect(marker.style.left).toBe('50%');
    expect(marker.style.top).toBe('50%');
  });

  it('clicking the image moves the marker and updates the preview object-position', () => {
    render(<FocalEditor photo={photo} onSave={noop} onRecalculate={noRecalc} onClose={() => {}} />);
    fireEvent.pointerDown(screen.getByTestId('focal-image'), { clientX: 25, clientY: 75 });
    expect(screen.getByRole('slider').style.left).toBe('25%');
    expect(screen.getByRole('slider').style.top).toBe('75%');
    const previews = screen.getAllByTestId('focal-preview');
    expect(previews[0]!.style.objectPosition).toBe('25% 75%');
  });

  it('Save calls onSave with the current coordinates then closes', async () => {
    const onSave = vi.fn(noop);
    const onClose = vi.fn();
    render(<FocalEditor photo={photo} onSave={onSave} onRecalculate={noRecalc} onClose={onClose} />);
    fireEvent.pointerDown(screen.getByTestId('focal-image'), { clientX: 10, clientY: 20 });
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }));
    await waitFor(() => expect(onSave).toHaveBeenCalledWith(0.1, 0.2));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it('Cancel closes without saving', () => {
    const onSave = vi.fn(noop);
    const onClose = vi.fn();
    render(<FocalEditor photo={photo} onSave={onSave} onRecalculate={noRecalc} onClose={onClose} />);
    fireEvent.pointerDown(screen.getByTestId('focal-image'), { clientX: 10, clientY: 20 });
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));
    expect(onSave).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it('Reset to center moves the marker to 50% 50%', () => {
    render(<FocalEditor photo={photo} onSave={noop} onRecalculate={noRecalc} onClose={() => {}} />);
    fireEvent.pointerDown(screen.getByTestId('focal-image'), { clientX: 10, clientY: 10 });
    fireEvent.click(screen.getByRole('button', { name: /reset to center/i }));
    expect(screen.getByRole('slider').style.left).toBe('50%');
    expect(screen.getByRole('slider').style.top).toBe('50%');
  });

  it('arrow keys nudge the marker and clamp at the image edge', () => {
    render(<FocalEditor photo={photo} onSave={noop} onRecalculate={noRecalc} onClose={() => {}} />);
    const marker = screen.getByRole('slider');
    for (let i = 0; i < 60; i += 1) fireEvent.keyDown(marker, { key: 'ArrowRight' });
    expect(marker.style.left).toBe('100%'); // clamped, never exceeds bounds
    for (let i = 0; i < 60; i += 1) fireEvent.keyDown(marker, { key: 'ArrowUp' });
    expect(marker.style.top).toBe('0%');
  });

  it('Recalculate updates the marker from the detector result', async () => {
    const onRecalculate = vi.fn(async () => ({ focalX: 0.2, focalY: 0.8 }));
    render(<FocalEditor photo={photo} onSave={noop} onRecalculate={onRecalculate} onClose={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /recalculate/i }));
    await waitFor(() => expect(screen.getByRole('slider').style.left).toBe('20%'));
    expect(screen.getByRole('slider').style.top).toBe('80%');
  });
});
