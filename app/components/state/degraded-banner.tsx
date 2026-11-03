import { useTranslation } from 'react-i18next';

import { Button } from '~/components/ui/button';
import { cn } from '~/lib/utils';

export interface DegradedBannerProps {
  /** Re-fetches the data (e.g. `useRevalidator().revalidate`); shows a "Try again" button. */
  retry?: () => void;
  className?: string;
}

/**
 * Shown above a data view whose loader returned `degraded: true`: the data is
 * a stale copy because Docker Hub is failing or the upstream budget is spent
 * (ADR-0003). Render it only in that case:
 *
 * ```tsx
 * {degraded && <DegradedBanner retry={revalidator.revalidate} />}
 * ```
 */
export function DegradedBanner({ retry, className }: DegradedBannerProps) {
  const { t } = useTranslation();

  return (
    <div
      role="status"
      className={cn(
        'flex flex-wrap items-center justify-between gap-3 rounded-md border border-border bg-secondary px-4 py-3 text-sm text-secondary-foreground',
        className,
      )}
    >
      <p>
        <strong className="font-semibold">{t('state.degraded.title')}</strong>{' '}
        {t('state.degraded.description')}
      </p>
      {retry && (
        <Button type="button" size="sm" variant="outline" onClick={retry}>
          {t('state.actions.retry')}
        </Button>
      )}
    </div>
  );
}
