import { useTranslation } from 'react-i18next';
import { useRevalidator } from 'react-router';

import { classifyRouteError, isRetryable } from '~/lib/route-error';

import { ErrorState } from './error-state';

export interface RouteErrorStateProps {
  /** The `error` an `ErrorBoundary` receives. */
  error: unknown;
}

/**
 * The page-level error state for an `ErrorBoundary` (the root one in
 * `app/root.tsx`): maps the thrown error to an `ErrorState` kind with
 * `classifyRouteError` and sets the document title.
 *
 * "Try again" revalidates the loaders when one threw a response (an upstream
 * failure or a 429), which clears the boundary once they succeed. A render
 * error isn't fixed by refetching, so it reloads the page instead.
 */
export function RouteErrorState({ error }: RouteErrorStateProps) {
  const { t } = useTranslation();
  const revalidator = useRevalidator();
  const { kind, retryAfterSeconds, isResponse } = classifyRouteError(error);

  const retry = () => {
    if (isResponse) void revalidator.revalidate();
    else window.location.reload();
  };

  return (
    <div className="mx-auto max-w-5xl px-6 py-12">
      <title>{t(`state.error.${kind}.title`)}</title>
      {isRetryable(kind) ? (
        <ErrorState
          kind={kind}
          retry={retry}
          retryAfterSeconds={retryAfterSeconds}
          headingLevel={1}
        />
      ) : (
        <ErrorState kind={kind} headingLevel={1} />
      )}
    </div>
  );
}
