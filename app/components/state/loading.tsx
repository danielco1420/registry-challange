import { useTranslation } from 'react-i18next';

import { cn } from '~/lib/utils';

export interface LoadingProps {
  /** Short text next to the spinner; defaults to "Loading…". */
  label?: string;
  className?: string;
}

/**
 * Loading state: a spinner with short text, no skeletons or illustrations
 * (questionnaire D25). A polite live region, so screen readers announce it.
 */
export function Loading({ label, className }: LoadingProps) {
  const { t } = useTranslation();

  return (
    <div
      role="status"
      className={cn(
        'flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground',
        className,
      )}
    >
      <svg
        aria-hidden="true"
        viewBox="0 0 24 24"
        fill="none"
        className="size-5 animate-spin text-brand motion-reduce:animate-none"
      >
        <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
        <path
          d="M21 12a9 9 0 0 0-9-9"
          stroke="currentColor"
          strokeWidth="3"
          strokeLinecap="round"
        />
      </svg>
      <span>{label ?? t('state.loading')}</span>
    </div>
  );
}
