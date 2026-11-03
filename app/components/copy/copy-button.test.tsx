import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import '~/i18n/i18next';

import { COPIED_MS, CopyButton } from './copy-button';

const COMMAND = 'docker pull nginx:latest';

/** Replaces `navigator.clipboard`; `undefined` mimics an insecure context. */
function mockClipboard(clipboard: Partial<Clipboard> | undefined) {
  Object.defineProperty(navigator, 'clipboard', { value: clipboard, configurable: true });
}

async function click(button: HTMLElement) {
  // `act` flushes the clipboard promise and the state updates after it.
  await act(async () => {
    fireEvent.click(button);
  });
}

afterEach(() => {
  Reflect.deleteProperty(navigator, 'clipboard');
  vi.useRealTimers();
});

describe('CopyButton', () => {
  it('is a labelled native button, so it takes keyboard focus and Enter/Space', () => {
    render(<CopyButton value={COMMAND} label="Copy docker pull nginx:latest" />);

    const button = screen.getByRole('button', { name: 'Copy docker pull nginx:latest' });
    expect(button.tagName).toBe('BUTTON');
    expect(button).toHaveAttribute('type', 'button');
    expect(button).toHaveTextContent('Copy');
    button.focus();
    expect(button).toHaveFocus();
  });

  it('copies the value, shows "Copied ✓" for ~2 s and announces it', async () => {
    vi.useFakeTimers();
    const writeText = vi.fn<(text: string) => Promise<void>>().mockResolvedValue(undefined);
    mockClipboard({ writeText });
    render(<CopyButton value={COMMAND} />);

    const status = screen.getByRole('status');
    expect(status).toHaveAttribute('aria-live', 'polite');
    expect(status).toBeEmptyDOMElement();

    await click(screen.getByRole('button', { name: 'Copy' }));

    expect(writeText).toHaveBeenCalledExactlyOnceWith(COMMAND);
    expect(screen.getByRole('button')).toHaveTextContent('Copied✓');
    expect(status).toHaveTextContent('Copied to clipboard.');
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();

    act(() => vi.advanceTimersByTime(COPIED_MS - 1));
    expect(screen.getByRole('button')).toHaveTextContent('Copied');

    act(() => vi.advanceTimersByTime(1));
    expect(screen.getByRole('button', { name: 'Copy' })).toBeInTheDocument();
    expect(status).toBeEmptyDOMElement();
  });

  it('restarts the 2 s window on a second click', async () => {
    vi.useFakeTimers();
    mockClipboard({ writeText: vi.fn().mockResolvedValue(undefined) });
    render(<CopyButton value={COMMAND} />);

    await click(screen.getByRole('button'));
    act(() => vi.advanceTimersByTime(COPIED_MS - 500));
    await click(screen.getByRole('button'));
    act(() => vi.advanceTimersByTime(COPIED_MS - 500));
    expect(screen.getByRole('button')).toHaveTextContent('Copied');

    act(() => vi.advanceTimersByTime(500));
    expect(screen.getByRole('button')).toHaveTextContent('Copy');
  });

  it.each([
    ['unavailable (no secure context)', undefined],
    ['without writeText', {}],
  ])(
    'falls back to a selected read-only input when the Clipboard API is %s',
    async (_case, clipboard) => {
      mockClipboard(clipboard);
      render(<CopyButton value={COMMAND} />);

      await click(screen.getByRole('button', { name: 'Copy' }));

      const input = screen.getByRole<HTMLInputElement>('textbox', { name: 'Text to copy' });
      expect(input).toHaveValue(COMMAND);
      expect(input).toHaveAttribute('readonly');
      expect(input).toHaveFocus();
      expect(input.selectionStart).toBe(0);
      expect(input.selectionEnd).toBe(COMMAND.length);
      expect(screen.getByRole('status')).toHaveTextContent(/press Ctrl\+C/);
      expect(screen.getByRole('button')).toHaveTextContent('Copy');
    },
  );

  it('falls back to the read-only input when writeText rejects', async () => {
    const writeText = vi.fn().mockRejectedValue(new DOMException('Denied', 'NotAllowedError'));
    mockClipboard({ writeText });
    render(<CopyButton value={COMMAND} />);

    await click(screen.getByRole('button'));

    expect(writeText).toHaveBeenCalledOnce();
    const input = screen.getByRole<HTMLInputElement>('textbox', { name: 'Text to copy' });
    expect(input).toHaveFocus();
    expect(input.selectionEnd).toBe(COMMAND.length);
  });

  it('selects the text again when the fallback input is already showing', async () => {
    mockClipboard(undefined);
    render(<CopyButton value={COMMAND} />);
    const button = screen.getByRole('button');
    await click(button);

    const input = screen.getByRole<HTMLInputElement>('textbox');
    button.focus();
    input.setSelectionRange(0, 0);
    await click(button);

    expect(input).toHaveFocus();
    expect(input.selectionEnd).toBe(COMMAND.length);
  });

  it('hides the fallback input once a later copy succeeds', async () => {
    const writeText = vi
      .fn<(text: string) => Promise<void>>()
      .mockRejectedValueOnce(new Error('denied'))
      .mockResolvedValue(undefined);
    mockClipboard({ writeText });
    render(<CopyButton value={COMMAND} />);

    await click(screen.getByRole('button'));
    expect(screen.getByRole('textbox')).toBeInTheDocument();

    await click(screen.getByRole('button'));
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Copied to clipboard.');
  });
});
