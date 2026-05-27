import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ContributeSheet } from '../components/ContributeSheet';

beforeEach(() => {
  Object.defineProperty(URL, 'createObjectURL', {
    value: vi.fn(() => 'blob:mock-url'),
    writable: true,
  });
});

describe('ContributeSheet', () => {
  it('renders nothing when closed', () => {
    const { container } = render(
      <ContributeSheet open={false} mode="remembrance" onClose={() => {}} onSubmit={() => {}} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('submit button is disabled when no file and no message', () => {
    render(
      <ContributeSheet open={true} mode="remembrance" onClose={() => {}} onSubmit={() => {}} />,
    );
    const button = screen.getByRole('button', { name: /add to the remembrance/i });
    expect(button).toBeDisabled();
  });

  it('enables submit once a message is typed', async () => {
    const user = userEvent.setup();
    render(
      <ContributeSheet open={true} mode="remembrance" onClose={() => {}} onSubmit={() => {}} />,
    );
    const textarea = screen.getByPlaceholderText(/a moment, a phrase/i);
    await user.type(textarea, 'A memory');
    const button = screen.getByRole('button', { name: /add to the remembrance/i });
    expect(button).toBeEnabled();
  });

  it('updates the character counter as you type', async () => {
    const user = userEvent.setup();
    render(
      <ContributeSheet open={true} mode="celebration" onClose={() => {}} onSubmit={() => {}} />,
    );
    const textarea = screen.getByPlaceholderText(/say something/i);
    await user.type(textarea, 'Hello');
    expect(screen.getByText(/5 \/ 240/)).toBeInTheDocument();
  });

  it('calls onSubmit with trimmed name + message when submitted', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const onClose = vi.fn();
    render(
      <ContributeSheet open={true} mode="celebration" onClose={onClose} onSubmit={onSubmit} />,
    );
    await user.type(screen.getByPlaceholderText(/e\.g\. maya/i), '  Maya  ');
    await user.type(screen.getByPlaceholderText(/say something/i), '  Hello!  ');
    await user.click(screen.getByRole('button', { name: /share with the wall/i }));
    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith({
        name: 'Maya',
        message: 'Hello!',
        file: null,
        previewUrl: null,
      }),
    );
  });

  it('calls onClose when the backdrop is clicked', () => {
    const onClose = vi.fn();
    const { container } = render(
      <ContributeSheet open={true} mode="remembrance" onClose={onClose} onSubmit={() => {}} />,
    );
    const backdrop = container.querySelector('.bg-black\\/55');
    fireEvent.click(backdrop!);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('stores a preview URL when a file is selected', async () => {
    render(
      <ContributeSheet open={true} mode="celebration" onClose={() => {}} onSubmit={() => {}} />,
    );
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(['test'], 'photo.jpg', { type: 'image/jpeg' });
    fireEvent.change(fileInput, { target: { files: [file] } });
    await waitFor(() => {
      expect(screen.getByText('photo.jpg')).toBeInTheDocument();
    });
    expect(URL.createObjectURL).toHaveBeenCalledWith(file);
  });
});
