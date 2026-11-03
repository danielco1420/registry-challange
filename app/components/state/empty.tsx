import type * as React from 'react';
import { useTranslation } from 'react-i18next';

import { cn } from '~/lib/utils';

export interface EmptyProps {
  /** Defaults to "No results". */
  title?: string;
  /** Says what to do next; defaults to "Try a different search, or clear the filters." */
  description?: string;
  /**
   * The call to action, e.g. a "Clear filters" `Button`. Required: every
   * empty state names a next action (questionnaire D25).
   */
  action: React.ReactNode;
  className?: string;
}

/** Empty state for a data view that loaded but has nothing to show. No illustrations. */
export function Empty({ title, description, action, className }: EmptyProps) {
  const { t } = useTranslation();

  return (
    <section
      className={cn(
        'flex flex-col items-center gap-3 rounded-lg border border-dashed border-border px-6 py-10 text-center',
        className,
      )}
    >
      <h2 className="text-lg font-semibold text-foreground">{title ?? t('state.empty.title')}</h2>
      <p className="max-w-prose text-sm text-muted-foreground">
        {description ?? t('state.empty.description')}
      </p>
      <div className="mt-1">{action}</div>
    </section>
  );
}
