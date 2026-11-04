import type * as React from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useLocation } from 'react-router';

import { Wordmark } from '~/components/brand/wordmark';
import { SearchBar } from '~/components/search/search-bar';
import { ThemeToggle } from '~/components/theme/theme-toggle';

/** Target of the skip link. */
export const MAIN_ID = 'main';

/**
 * The page frame around every route, error pages included (rendered from
 * `Layout` in `app/root.tsx`): skip link, header (`banner`), `main` and footer
 * (`contentinfo`). Desktop-first (questionnaire E29): laid out for 768 px and
 * up; narrower screens still work.
 */
export function AppShell({ children }: { children: React.ReactNode }) {
  const { t } = useTranslation();
  // Explore (`/`) has its own, larger search box; a second one in the header
  // would only add a duplicate search landmark.
  const { pathname } = useLocation();
  const showHeaderSearch = pathname !== '/';

  return (
    <div className="flex min-h-dvh flex-col">
      {/* Off-screen until focused; the first stop for keyboard users. */}
      <a
        href={`#${MAIN_ID}`}
        className="fixed top-3 left-3 z-50 -translate-y-[200%] rounded-md border border-border bg-background px-4 py-2 text-sm font-medium text-foreground shadow-md focus:translate-y-0"
      >
        {t('shell.skipToContent')}
      </a>

      <header className="border-b border-border bg-background">
        <div className="mx-auto flex h-16 w-full max-w-6xl items-center gap-6 px-6">
          <Link to="/" className="shrink-0 rounded-sm text-lg">
            <Wordmark />
          </Link>

          <div data-slot="header-search" className="min-w-0 flex-1">
            {showHeaderSearch && <SearchBar variant="header" className="max-w-xl" />}
          </div>

          <ThemeToggle className="shrink-0" />
        </div>
      </header>

      {/* tabIndex -1 so the skip link moves focus here in every browser. */}
      <main
        id={MAIN_ID}
        tabIndex={-1}
        className="mx-auto w-full max-w-6xl flex-1 px-6 py-10 outline-hidden"
      >
        {children}
      </main>

      <footer className="border-t border-border">
        <div className="mx-auto w-full max-w-6xl px-6 py-6 text-sm text-muted-foreground">
          <p>{t('shell.footer.disclaimer')}</p>
        </div>
      </footer>
    </div>
  );
}
