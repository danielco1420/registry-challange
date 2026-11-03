import { useTranslation } from 'react-i18next';

import { cn } from '~/lib/utils';

/**
 * The app's wordmark: three stacked crates and the name "Danny's Dockers".
 * Our own mark, deliberately unlike Docker's logo (no whale, no Docker
 * trademarks). The mark is decorative; the name is the accessible text.
 */
export function Wordmark({ className }: { className?: string }) {
  const { t } = useTranslation();

  return (
    <span
      data-slot="wordmark"
      className={cn('inline-flex items-center gap-2 font-semibold tracking-tight', className)}
    >
      <svg
        aria-hidden="true"
        focusable="false"
        viewBox="0 0 24 24"
        className="size-[1.25em] shrink-0 fill-primary stroke-brand"
        strokeWidth={1.5}
        strokeLinejoin="round"
      >
        <rect x="7.5" y="3" width="9" height="8" rx="1.5" />
        <rect x="2.5" y="13" width="9" height="8" rx="1.5" />
        <rect x="12.5" y="13" width="9" height="8" rx="1.5" />
      </svg>
      <span>{t('brand.name')}</span>
    </span>
  );
}
