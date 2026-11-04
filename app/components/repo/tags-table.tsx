import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';

import { CopyButton } from '~/components/copy/copy-button';
import type { Tag } from '~/lib/dto';
import { formatRelativeDate, formatSize } from '~/lib/format';
import type { TagOrdering } from '~/lib/params';
import { pullCommand } from '~/lib/pull-command';
import { nextOrdering, sortDirection, type TagSortColumn } from '~/lib/tags-query';
import { cn } from '~/lib/utils';

export interface TagsTableProps {
  tags: Tag[];
  /** The repository's namespace (`library` for official images) and name, for the pull command. */
  namespace: string;
  repo: string;
  /** The current sort; the Tag and Last updated headers link to the next one. */
  ordering: TagOrdering;
  /** The tab's URL for an `ordering`, keeping the name filter. */
  sortHref: (ordering: TagOrdering) => string;
  /** Names the table for screen readers, e.g. "Tags of nginx". */
  caption: string;
  /** Reference time for "3 days ago"; tests pin it. Defaults to now. */
  now?: number;
  className?: string;
}

const HEADER_CELL = 'px-3 py-2 text-left font-medium text-muted-foreground';
const SORT_LINK =
  'inline-flex items-center gap-1 rounded-sm outline-hidden hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring';

function SortHeader({
  column,
  label,
  ordering,
  sortHref,
}: {
  column: TagSortColumn;
  label: string;
  ordering: TagOrdering;
  sortHref: TagsTableProps['sortHref'];
}) {
  const direction = sortDirection(column, ordering);
  return (
    <th scope="col" aria-sort={direction ?? 'none'} className={HEADER_CELL}>
      <Link
        to={sortHref(nextOrdering(column, ordering))}
        preventScrollReset
        className={cn(SORT_LINK, direction && 'text-foreground')}
      >
        {label}
        <span aria-hidden="true" className="text-xs">
          {direction === 'ascending' ? '↑' : direction === 'descending' ? '↓' : '↕'}
        </span>
      </Link>
    </th>
  );
}

/**
 * The tag list (questionnaire D23): tag, last updated, size and a copyable
 * `docker pull` command (D27), which leaves out the `library` namespace
 * (CLAUDE.md hard rule 6). The Tag and Last updated headers are sort links
 * with `aria-sort`; Docker Hub can't sort by size, so that column isn't one.
 * Wide content scrolls inside the table's own box.
 */
export function TagsTable({
  tags,
  namespace,
  repo,
  ordering,
  sortHref,
  caption,
  now,
  className,
}: TagsTableProps) {
  const { t } = useTranslation();

  return (
    <div className={cn('overflow-x-auto rounded-lg border border-border', className)}>
      <table className="w-full min-w-[40rem] border-collapse text-sm">
        <caption className="sr-only">{caption}</caption>
        <thead className="border-b border-border bg-muted/50">
          <tr>
            <SortHeader
              column="name"
              label={t('repo.tags.table.name')}
              ordering={ordering}
              sortHref={sortHref}
            />
            <SortHeader
              column="last_updated"
              label={t('repo.tags.table.updated')}
              ordering={ordering}
              sortHref={sortHref}
            />
            <th scope="col" className={HEADER_CELL}>
              {t('repo.tags.table.size')}
            </th>
            <th scope="col" className={HEADER_CELL}>
              {t('repo.tags.table.pull')}
            </th>
          </tr>
        </thead>
        <tbody>
          {tags.map((tag) => {
            const command = pullCommand(namespace, repo, tag.name);
            const updated = tag.updatedAt ? formatRelativeDate(tag.updatedAt, now) : undefined;
            return (
              <tr key={tag.name} className="border-b border-border last:border-b-0">
                <th
                  scope="row"
                  className="px-3 py-2 text-left font-mono font-medium text-foreground wrap-anywhere"
                >
                  {tag.name}
                </th>
                <td className="px-3 py-2 whitespace-nowrap text-muted-foreground">
                  {updated ? (
                    // The relative text depends on the clock, so it can differ
                    // by a unit between the server render and hydration.
                    <time
                      dateTime={tag.updatedAt}
                      title={updated.absolute}
                      suppressHydrationWarning
                    >
                      {updated.relative}
                    </time>
                  ) : (
                    '—'
                  )}
                </td>
                <td className="px-3 py-2 whitespace-nowrap tabular-nums text-muted-foreground">
                  {formatSize(tag.size)}
                </td>
                <td className="px-3 py-2">
                  <div className="flex items-center justify-between gap-3">
                    <code className="min-w-0 font-mono text-xs text-foreground wrap-anywhere">
                      {command}
                    </code>
                    <CopyButton value={command} label={t('repo.tags.copyLabel', { command })} />
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
