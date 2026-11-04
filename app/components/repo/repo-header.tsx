import { useTranslation } from 'react-i18next';

import { Badge } from '~/components/ui/badge';
import type { RepoDetails } from '~/lib/dto';
import { formatCompactNumber, formatRelativeDate } from '~/lib/format';
import { OFFICIAL_NAMESPACE } from '~/lib/pull-command';
import { cn } from '~/lib/utils';

import { FavoriteButton } from './favorite-button';
import { RepoBadge } from './repo-badge';
import { RepoLogo } from './repo-logo';

export interface RepoHeaderProps {
  repo: Pick<
    RepoDetails,
    | 'id'
    | 'namespace'
    | 'name'
    | 'displayName'
    | 'owner'
    | 'description'
    | 'logoUrl'
    | 'badge'
    | 'archived'
    | 'pullsLabel'
    | 'pulls'
    | 'stars'
    | 'updatedAt'
  >;
  /** Reference time for "Updated 3 days ago"; tests pin it. Defaults to now. */
  now?: number;
  className?: string;
}

/**
 * The repository page's header (questionnaire D24): logo, name (the page's
 * `h1`), owner, short description, trust badge, "Archived", last updated
 * (relative, absolute on hover), pulls and stars.
 *
 * Official images skip the owner line: their namespace is `library`, and the
 * "Official Image" badge already says who publishes them.
 *
 * The favorite toggle (questionnaire E28, T21) joins the title row, pushed
 * to the end by `ml-auto`.
 */
export function RepoHeader({ repo, now, className }: RepoHeaderProps) {
  const { t } = useTranslation();
  const description = repo.description.trim();
  const updated = repo.updatedAt ? formatRelativeDate(repo.updatedAt, now) : undefined;

  return (
    <header className={cn('flex min-w-0 items-start gap-4', className)}>
      <RepoLogo namespace={repo.namespace} name={repo.name} logoUrl={repo.logoUrl} size="lg" />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <h1 className="min-w-0 text-3xl font-semibold leading-tight wrap-anywhere">
            {repo.displayName}
          </h1>
          <RepoBadge badge={repo.badge} />
          {repo.archived && <Badge variant="outline">{t('repo.archived')}</Badge>}
          <FavoriteButton repo={repo} className="ml-auto" />
        </div>

        {repo.namespace !== OFFICIAL_NAMESPACE && (
          <p className="mt-1 text-sm text-muted-foreground wrap-anywhere">
            {t('repo.by', { owner: repo.owner })}
          </p>
        )}

        <p
          className={cn(
            'mt-3 max-w-prose wrap-anywhere',
            description ? 'text-foreground' : 'italic text-muted-foreground',
          )}
        >
          {description || t('repo.noDescription')}
        </p>

        <dl className="mt-4 flex flex-wrap gap-x-6 gap-y-2 text-sm">
          <div className="flex gap-1.5">
            <dt className="text-muted-foreground">{t('repo.stats.updated')}</dt>
            <dd className="font-medium">
              {updated ? (
                // The relative text depends on the clock, so it can differ by
                // a unit between the server render and hydration.
                <time dateTime={repo.updatedAt} title={updated.absolute} suppressHydrationWarning>
                  {updated.relative}
                </time>
              ) : (
                t('repo.stats.unknown')
              )}
            </dd>
          </div>
          <div className="flex gap-1.5">
            <dt className="text-muted-foreground">{t('repo.stats.pulls')}</dt>
            <dd className="font-medium">{repo.pullsLabel || formatCompactNumber(repo.pulls)}</dd>
          </div>
          <div className="flex gap-1.5">
            <dt className="text-muted-foreground">{t('repo.stats.stars')}</dt>
            <dd className="font-medium">{formatCompactNumber(repo.stars)}</dd>
          </div>
        </dl>
      </div>
    </header>
  );
}
