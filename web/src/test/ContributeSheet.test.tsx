import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ContributeSheet } from '../components/ContributeSheet';

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

  it('shows the selected filename without creating an object URL', async () => {
    const originalCreateObjectURL = URL.createObjectURL;
    const createObjectURL = vi.fn(() => 'blob:mock-url');
    Object.defineProperty(URL, 'createObjectURL', {
      value: createObjectURL,
      configurable: true,
    });
    render(
      <ContributeSheet open={true} mode="celebration" onClose={() => {}} onSubmit={() => {}} />,
    );
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(['test'], 'photo.jpg', { type: 'image/jpeg' });
    fireEvent.change(fileInput, { target: { files: [file] } });
    await waitFor(() => {
      expect(screen.getByText('photo.jpg')).toBeInTheDocument();
    });
    expect(createObjectURL).not.toHaveBeenCalled();
    Object.defineProperty(URL, 'createObjectURL', {
      value: originalCreateObjectURL,
      configurable: true,
    });
  });

  it('renders server error on 413 response', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockRejectedValue(new Error('file too large (max 10MB)'));
    render(
      <ContributeSheet open={true} mode="remembrance" onClose={() => {}} onSubmit={onSubmit} />,
    );
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(fileInput, { target: { files: [new File(['x'], 'p.jpg', { type: 'image/jpeg' })] } });
    await user.click(screen.getByRole('button', { name: /add to the remembrance/i }));
    await waitFor(() =>
      expect(screen.getByText('file too large (max 10MB)')).toBeInTheDocument(),
    );
  });

  it('renders server error on 415 response', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockRejectedValue(
      new Error('unsupported image type — JPEG, PNG, or WebP only'),
    );
    render(
      <ContributeSheet open={true} mode="remembrance" onClose={() => {}} onSubmit={onSubmit} />,
    );
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(fileInput, { target: { files: [new File(['x'], 'p.jpg', { type: 'image/jpeg' })] } });
    await user.click(screen.getByRole('button', { name: /add to the remembrance/i }));
    await waitFor(() =>
      expect(
        screen.getByText('unsupported image type — JPEG, PNG, or WebP only'),
      ).toBeInTheDocument(),
    );
  });

  it('renders HTML-looking server errors as plain text', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockRejectedValue(new Error('<img src=x onerror=alert(1)>'));
    render(
      <ContributeSheet open={true} mode="remembrance" onClose={() => {}} onSubmit={onSubmit} />,
    );
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(fileInput, { target: { files: [new File(['x'], 'p.jpg', { type: 'image/jpeg' })] } });
    await user.click(screen.getByRole('button', { name: /add to the remembrance/i }));
    await waitFor(() =>
      expect(screen.getByText('<img src=x onerror=alert(1)>')).toBeInTheDocument(),
    );
    expect(document.querySelector('.upload-error img')).toBeNull();
  });

  it('clears error when a new file is picked', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockRejectedValue(new Error('file too large (max 10MB)'));
    render(
      <ContributeSheet open={true} mode="remembrance" onClose={() => {}} onSubmit={onSubmit} />,
    );
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(fileInput, { target: { files: [new File(['x'], 'p.jpg', { type: 'image/jpeg' })] } });
    await user.click(screen.getByRole('button', { name: /add to the remembrance/i }));
    await waitFor(() =>
      expect(screen.getByText('file too large (max 10MB)')).toBeInTheDocument(),
    );
    fireEvent.change(fileInput, { target: { files: [new File(['x'], 'p2.jpg', { type: 'image/jpeg' })] } });
    await waitFor(() =>
      expect(screen.queryByText('file too large (max 10MB)')).not.toBeInTheDocument(),
    );
  });
});
