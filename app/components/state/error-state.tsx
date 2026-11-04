import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';

import { Button } from '~/components/ui/button';
import type { ErrorKind, RetryableKind } from '~/lib/route-error';
import { cn } from '~/lib/utils';

type HeadingLevel = 1 | 2 | 3;

interface CommonProps {
  /** `1` when the error replaces the whole page (the root `ErrorBoundary`); `2` inside a section. */
  headingLevel?: HeadingLevel;
  /** From `Retry-After`; adds "You can try again in N seconds." to a retryable state. */
  retryAfterSeconds?: number;
  className?: string;
}

/**
 * The retryable kinds must get a `retry` callback, so "Try again" always works.
 * The not-found kinds only offer "Back to Explore".
 */
export type ErrorStateProps = CommonProps &
  (
    | { kind: RetryableKind; retry: () => void }
    | { kind: Exclude<ErrorKind, RetryableKind>; retry?: never }
  );

/**
 * Error state (questionnaire C16, D25): generic 404, repository not found,
 * Docker Hub unavailable, rate limited, or an unexpected error. Every message
 * names its next action, and the matching buttons follow. No illustrations.
 */
export function ErrorState({
  kind,
  retry,
  headingLevel = 2,
  retryAfterSeconds,
  className,
}: ErrorStateProps) {
  const { t } = useTranslation();
  const headingId = useId();
  const Heading = `h${headingLevel}` as const;
  const showRetryAfter = retry !== undefined && retryAfterSeconds !== undefined;

  return (
    <section
      aria-labelledby={headingId}
      className={cn('flex flex-col items-center gap-3 px-6 py-12 text-center', className)}
    >
      <Heading id={headingId} className="text-2xl font-semibold text-foreground">
        {t(`state.error.${kind}.title`)}
      </Heading>
      <p className="max-w-prose text-muted-foreground">
        {t(`state.error.${kind}.description`)}
        {showRetryAfter && <> {t('state.retryIn', { count: retryAfterSeconds })}</>}
      </p>
      <div className="mt-2 flex flex-wrap items-center justify-center gap-3">
        {retry && (
          <Button type="button" onClick={retry}>
            {t('state.actions.retry')}
          </Button>
        )}
        <Button asChild variant={retry ? 'outline' : 'default'}>
          <Link to="/">{t('state.actions.backToExplore')}</Link>
        </Button>
      </div>
    </section>
  );
}
