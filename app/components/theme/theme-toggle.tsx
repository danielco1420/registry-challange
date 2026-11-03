import type * as React from 'react';
import { useTranslation } from 'react-i18next';
import { useFetcher, useLocation } from 'react-router';

import { Button } from '~/components/ui/button';
import { THEME_ACTION_PATH, THEME_FETCHER_KEY, THEMES, type Theme } from '~/lib/theme';
import { cn } from '~/lib/utils';

import { useTheme } from './use-theme';

/**
 * Light / Dark / System switch (questionnaire D19): three toggle buttons in a
 * labelled group, the current choice `aria-pressed`.
 *
 * With JavaScript, a click submits through the shared theme fetcher, so the
 * page switches at once (see `useTheme`) and the root loader picks up the new
 * cookie. Without it, the buttons submit the surrounding form natively and the
 * action redirects back to `redirectTo`.
 */
export function ThemeToggle({ className }: { className?: string }) {
  const { t } = useTranslation();
  const theme = useTheme();
  const fetcher = useFetcher({ key: THEME_FETCHER_KEY });
  const location = useLocation();

  function choose(event: React.MouseEvent<HTMLButtonElement>, value: Theme) {
    event.preventDefault();
    if (value === theme) return;
    void fetcher.submit({ theme: value }, { method: 'post', action: THEME_ACTION_PATH });
  }

  return (
    <form method="post" action={THEME_ACTION_PATH} className={className}>
      <input type="hidden" name="redirectTo" value={location.pathname + location.search} />
      <div
        role="group"
        aria-label={t('theme.label')}
        className="inline-flex items-center gap-0.5 rounded-md border border-input bg-background p-0.5"
      >
        {THEMES.map((value) => {
          const label = t(`theme.${value}`);
          const pressed = value === theme;
          return (
            <Button
              key={value}
              type="submit"
              name="theme"
              value={value}
              variant="ghost"
              size="icon"
              aria-pressed={pressed}
              title={label}
              onClick={(event) => choose(event, value)}
              className={cn(
                'size-8 text-muted-foreground hover:text-foreground',
                pressed && 'bg-accent text-accent-foreground hover:text-accent-foreground',
              )}
            >
              <ThemeIcon theme={value} />
              <span className="sr-only">{label}</span>
            </Button>
          );
        })}
      </div>
    </form>
  );
}

/** Sun, moon and monitor, drawn inline (no icon library). Decorative. */
function ThemeIcon({ theme }: { theme: Theme }) {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="size-4"
    >
      {theme === 'light' && (
        <>
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
        </>
      )}
      {theme === 'dark' && <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />}
      {theme === 'system' && (
        <>
          <rect x="2" y="3" width="20" height="14" rx="2" />
          <path d="M8 21h8M12 17v4" />
        </>
      )}
    </svg>
  );
}
