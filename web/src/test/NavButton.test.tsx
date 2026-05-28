import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { NavButton } from '../components/NavButton';

describe('NavButton', () => {
  it('prev direction renders aria-label "Previous slide"', () => {
    render(<NavButton direction="prev" onClick={() => {}} hidden={false} />);
    expect(screen.getByLabelText('Previous slide')).toBeInTheDocument();
  });

  it('next direction renders aria-label "Next slide"', () => {
    render(<NavButton direction="next" onClick={() => {}} hidden={false} />);
    expect(screen.getByLabelText('Next slide')).toBeInTheDocument();
  });

  it('clicking the button calls onClick', () => {
    const onClick = vi.fn();
    render(<NavButton direction="next" onClick={onClick} hidden={false} />);
    fireEvent.click(screen.getByLabelText('Next slide'));
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('hidden=true sets opacity 0 and pointerEvents none', () => {
    render(<NavButton direction="prev" onClick={() => {}} hidden={true} />);
    const btn = screen.getByLabelText('Previous slide');
    expect(btn.style.opacity).toBe('0');
    expect(btn.style.pointerEvents).toBe('none');
  });

  it('hidden=false sets opacity 1 and pointerEvents auto', () => {
    render(<NavButton direction="prev" onClick={() => {}} hidden={false} />);
    const btn = screen.getByLabelText('Previous slide');
    expect(btn.style.opacity).toBe('1');
    expect(btn.style.pointerEvents).toBe('auto');
  });
});
