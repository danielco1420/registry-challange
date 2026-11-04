import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';

import type { RepoSummary } from '~/lib/dto';
import { repoPath } from '~/lib/repo-path';
import { cn } from '~/lib/utils';

import { FavoriteButton } from './favorite-button';
import { RepoBadge } from './repo-badge';
import { RepoLogo } from './repo-logo';

export interface RepoCardProps {
  repo: Pick<
    RepoSummary,
    'id' | 'namespace' | 'name' | 'displayName' | 'owner' | 'description' | 'logoUrl' | 'badge'
  >;
  /** The heading level of the name: `3` under a section's `h2` (default), `2` directly under the page's `h1`. */
  headingLevel?: 2 | 3;
  className?: string;
}

/**
 * A repository in the Explore grid (questionnaire D21, D22): logo, name,
 * owner, description and the official / verified badge. Stats live on the
 * repository page.
 *
 * The name is the card's main link, stretched over the whole card, so the
 * card is reached in one tab stop and the link's name is just the
 * repository name. The favorite toggle (T21) is the card's second, separate
 * tab stop, after the link in tab order and overlaid top-right so it stays
 * clickable above the stretched link. A missing description reads "No description"; a missing logo falls
 * back to the publisher's avatar, then initials (`RepoLogo`).
 */
export function RepoCard({ repo, headingLevel = 3, className }: RepoCardProps) {
  const { t } = useTranslation();
  const Heading = `h${headingLevel}` as const;
  const description = repo.description.trim();

  return (
    <article
      className={cn(
        'relative flex flex-col gap-3 rounded-lg border border-border bg-card p-4 text-card-foreground shadow-xs transition-colors',
        'hover:border-brand focus-within:border-brand',
        className,
      )}
    >
      <div className="flex items-start gap-3 pr-8">
        <RepoLogo namespace={repo.namespace} name={repo.name} logoUrl={repo.logoUrl} />
        <div className="min-w-0 flex-1">
          <Heading className="truncate text-base font-semibold leading-tight">
            <Link
              to={repoPath(repo.namespace, repo.name)}
              title={repo.displayName}
              // Stretched link: the ::after box covers the card. The
              // favorite button sits above it (explicit z-index), so it
              // stays its own tab stop and click target.
              className="rounded-sm outline-hidden after:absolute after:inset-0 after:rounded-lg focus-visible:after:ring-[3px] focus-visible:after:ring-ring"
            >
              {repo.displayName}
            </Link>
          </Heading>
          <p className="mt-1 truncate text-sm text-muted-foreground">
            {t('repo.by', { owner: repo.owner })}
          </p>
        </div>
      </div>
      <p
        className={cn(
          'line-clamp-2 text-sm',
          description ? 'text-card-foreground' : 'italic text-muted-foreground',
        )}
      >
        {description || t('repo.noDescription')}
      </p>
      {repo.badge !== 'none' && (
        <div className="mt-auto flex flex-wrap gap-2">
          <RepoBadge badge={repo.badge} />
        </div>
      )}
      {/* Last in the DOM so Tab reaches the card's link first, then its heart;
          absolutely positioned, so it still shows top-right. */}
      <FavoriteButton repo={repo} className="absolute right-3 top-3 z-10" />
    </article>
  );
}
