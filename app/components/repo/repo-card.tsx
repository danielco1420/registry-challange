import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';

import type { RepoSummary } from '~/lib/dto';
import { repoPath } from '~/lib/repo-path';
import { cn } from '~/lib/utils';

import { RepoBadge } from './repo-badge';
import { RepoLogo } from './repo-logo';

export interface RepoCardProps {
  repo: Pick<
    RepoSummary,
    'namespace' | 'name' | 'displayName' | 'owner' | 'description' | 'logoUrl' | 'badge'
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
 * The name is the card's only link, stretched over the whole card, so the
 * card is a single tab stop and the link's name is just the repository name.
 * A missing description reads "No description"; a missing logo falls back to
 * the publisher's avatar, then initials (`RepoLogo`).
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
      <div className="flex items-start gap-3">
        <RepoLogo namespace={repo.namespace} name={repo.name} logoUrl={repo.logoUrl} />
        <div className="min-w-0 flex-1">
          <Heading className="truncate text-base font-semibold leading-tight">
            <Link
              to={repoPath(repo.namespace, repo.name)}
              title={repo.displayName}
              // Stretched link: the ::after box covers the card, so the whole
              // card is clickable while the name stays the only tab stop.
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
    </article>
  );
}
