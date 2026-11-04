import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '~/components/ui/button';
import { cn } from '~/lib/utils';

/** How long the button reads "Copied ✓" (questionnaire D27). */
export const COPIED_MS = 2000;

type Status = 'idle' | 'copied' | 'manual';

function focusAndSelect(input: HTMLInputElement | null) {
  input?.focus();
  input?.select();
}

export interface CopyButtonProps {
  /** The text to copy, e.g. `pullCommand(ns, repo, tag)`. */
  value: string;
  /**
   * The button's accessible name while idle, e.g. "Copy docker pull nginx:latest".
   * Defaults to its visible text, "Copy".
   */
  label?: string;
  className?: string;
}

/**
 * Copies `value` to the clipboard (questionnaire D27, RISKS.md 4.4).
 *
 * On success the button reads "Copied ✓" for ~2 s, and a polite live region
 * announces "Copied to clipboard." If the Clipboard API is missing (no secure
 * context) or refuses, a read-only input with the text appears, focused and
 * selected, and the live region says to press Ctrl+C. A native `<button>`, so
 * Enter and Space work.
 */
export function CopyButton({ value, label, className }: CopyButtonProps) {
  const { t } = useTranslation();
  const [status, setStatus] = useState<Status>('idle');
  // Bumped on every attempt, so the live region's text is a new node each time
  // and a repeated "Copied to clipboard." is announced again.
  const [attempt, setAttempt] = useState(0);
  const resetTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const manualInput = useRef<HTMLInputElement>(null);
  const mounted = useRef(false);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      clearTimeout(resetTimer.current);
    };
  }, []);

  // Focus and select the fallback input when it appears.
  useEffect(() => {
    if (status === 'manual') focusAndSelect(manualInput.current);
  }, [status]);

  async function copy() {
    clearTimeout(resetTimer.current);
    try {
      // `navigator.clipboard` is undefined outside a secure context.
      const clipboard = navigator.clipboard as Clipboard | undefined;
      if (!clipboard?.writeText) throw new Error('Clipboard API unavailable');
      await clipboard.writeText(value);
      // Unmounted while waiting (e.g. on a permission prompt): arm no timer.
      if (!mounted.current) return;
      setStatus('copied');
      setAttempt((n) => n + 1);
      // Overlapping clicks: drop the earlier click's timer so the full 2 s count from the last one.
      clearTimeout(resetTimer.current);
      resetTimer.current = setTimeout(() => setStatus('idle'), COPIED_MS);
    } catch {
      if (!mounted.current) return;
      setStatus('manual');
      setAttempt((n) => n + 1);
      // Already showing: the effect won't run again, so select it here.
      focusAndSelect(manualInput.current);
    }
  }

  const announcement =
    status === 'copied'
      ? t('copy.copiedAnnouncement')
      : status === 'manual'
        ? t('copy.manualAnnouncement')
        : '';

  return (
    <span className={cn('inline-flex items-center gap-2', className)}>
      {status === 'manual' && (
        <input
          ref={manualInput}
          type="text"
          readOnly
          value={value}
          aria-label={t('copy.manualLabel')}
          onFocus={(event) => event.currentTarget.select()}
          className="h-8 w-64 min-w-0 rounded-md border border-input bg-background px-2 font-mono text-sm text-foreground"
        />
      )}
      <Button
        type="button"
        variant="outline"
        size="sm"
        aria-label={status === 'copied' ? undefined : label}
        onClick={() => void copy()}
      >
        {status === 'copied' ? (
          <>
            {t('copy.copied')}
            <span aria-hidden="true">✓</span>
          </>
        ) : (
          t('copy.copy')
        )}
      </Button>
      <span role="status" aria-live="polite" className="sr-only">
        {announcement && <span key={attempt}>{announcement}</span>}
      </span>
    </span>
  );
}
