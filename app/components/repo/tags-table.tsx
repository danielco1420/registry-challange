import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';

import { CopyButton } from '~/components/copy/copy-button';
import type { Tag, TagImage } from '~/lib/dto';
import { formatRelativeDate, formatSize } from '~/lib/format';
import type { TagOrdering } from '~/lib/params';
import { platformLabel, shortDigest } from '~/lib/platform';
import { pullByDigest, pullCommand } from '~/lib/pull-command';
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
const COLUMN_COUNT = 5;

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
 * Each tag expands (`TagRows`) into its per-platform breakdown with
 * pull-by-digest commands (D23, E28). Wide content scrolls inside the
 * table's own box.
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
            <th scope="col" className="w-0 pl-2">
              <span className="sr-only">{t('repo.tags.table.details')}</span>
            </th>
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
        {tags.map((tag) => (
          <TagRows key={tag.name} tag={tag} namespace={namespace} repo={repo} now={now} />
        ))}
      </table>
    </div>
  );
}

interface RepoRef {
  namespace: string;
  repo: string;
}

/**
 * One tag: its summary row and the detail row it expands into. Each tag is
 * its own `<tbody>`, so the pair shares one bottom border. The toggle is a
 * native `<button>` (Enter and Space work) with `aria-expanded`, and its
 * `aria-controls` names the detail row, which is always in the DOM but
 * `hidden` (and empty) while collapsed. The expanded state is local, so a
 * new sort or filter starts collapsed.
 */
function TagRows({ tag, namespace, repo, now }: RepoRef & { tag: Tag; now?: number }) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const detailsId = useId();
  const command = pullCommand(namespace, repo, tag.name);
  const updated = tag.updatedAt ? formatRelativeDate(tag.updatedAt, now) : undefined;

  return (
    <tbody className="border-b border-border last:border-b-0">
      <tr>
        <td className="w-0 py-2 pr-0 pl-2 align-top">
          <button
            type="button"
            aria-expanded={expanded}
            aria-controls={detailsId}
            aria-label={t('repo.tags.platforms.toggle', { tag: tag.name })}
            onClick={() => setExpanded((value) => !value)}
            className="inline-flex size-6 items-center justify-center rounded-sm text-muted-foreground outline-hidden hover:bg-accent hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring"
          >
            <span
              aria-hidden="true"
              className={cn('text-[0.625rem] transition-transform', expanded && 'rotate-90')}
            >
              ▶
            </span>
          </button>
        </td>
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
            <time dateTime={tag.updatedAt} title={updated.absolute} suppressHydrationWarning>
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
      <tr id={detailsId} hidden={!expanded} className="bg-muted/30">
        <td colSpan={COLUMN_COUNT} className="px-3 py-3">
          {expanded && <PlatformBreakdown tag={tag} namespace={namespace} repo={repo} />}
        </td>
      </tr>
    </tbody>
  );
}

const SUB_HEADER_CELL = 'px-2 py-1.5 text-left font-medium text-muted-foreground';

/**
 * The tag's per-platform images (questionnaire D23, E28): OS/arch(+variant),
 * digest (short, the full one on hover), size, and a Copy button for that
 * platform's `docker pull image@sha256:…`. The tag's own digest (the
 * multi-platform index) gets a Copy button too. A tag without platform
 * images says so instead of expanding into nothing.
 */
function PlatformBreakdown({ tag, namespace, repo }: RepoRef & { tag: Tag }) {
  const { t } = useTranslation();
  // The normalizer always sends `images`, but a DTO from an older cache entry or
  // another caller might not: treat a missing list as an empty one.
  const images: TagImage[] = (tag.images as TagImage[] | undefined) ?? [];

  return (
    <div className="flex flex-col gap-3">
      {tag.digest && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="text-muted-foreground">{t('repo.tags.platforms.tagDigest')}</span>
          <code title={tag.digest} className="font-mono text-xs text-foreground">
            {shortDigest(tag.digest)}
          </code>
          <CopyButton
            value={pullByDigest(namespace, repo, tag.digest)}
            label={t('repo.tags.platforms.copyTagLabel', { tag: tag.name })}
          />
        </div>
      )}

      {images.length === 0 ? (
        <p className="text-muted-foreground">{t('repo.tags.platforms.empty')}</p>
      ) : (
        <table className="w-full border-collapse text-sm">
          <caption className="sr-only">
            {t('repo.tags.platforms.caption', { tag: tag.name })}
          </caption>
          <thead className="border-b border-border">
            <tr>
              <th scope="col" className={SUB_HEADER_CELL}>
                {t('repo.tags.platforms.platform')}
              </th>
              <th scope="col" className={SUB_HEADER_CELL}>
                {t('repo.tags.platforms.digest')}
              </th>
              <th scope="col" className={SUB_HEADER_CELL}>
                {t('repo.tags.platforms.size')}
              </th>
              <th scope="col" className={SUB_HEADER_CELL}>
                {t('repo.tags.platforms.pull')}
              </th>
            </tr>
          </thead>
          <tbody>
            {images.map((image, index) => (
              <PlatformRow
                // Docker Hub can list one manifest twice (e.g. arm64 with and
                // without `v8`), so the digest alone isn't a unique key. The
                // list never reorders, so the position keeps it unique.
                key={`${image.digest ?? platformLabel(image)}#${index}`}
                tagName={tag.name}
                image={image}
                namespace={namespace}
                repo={repo}
              />
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function PlatformRow({
  tagName,
  image,
  namespace,
  repo,
}: RepoRef & { tagName: string; image: TagImage }) {
  const { t } = useTranslation();
  const platform = platformLabel(image);

  return (
    <tr className="border-b border-border/60 last:border-b-0">
      <th scope="row" className="px-2 py-1.5 text-left font-mono font-normal text-foreground">
        {platform}
      </th>
      <td className="px-2 py-1.5 text-muted-foreground">
        {image.digest ? (
          <code title={image.digest} className="font-mono text-xs">
            {shortDigest(image.digest)}
          </code>
        ) : (
          '—'
        )}
      </td>
      <td className="px-2 py-1.5 whitespace-nowrap tabular-nums text-muted-foreground">
        {formatSize(image.size)}
      </td>
      <td className="px-2 py-1.5">
        {image.digest ? (
          <CopyButton
            value={pullByDigest(namespace, repo, image.digest)}
            label={t('repo.tags.platforms.copyLabel', { tag: tagName, platform })}
          />
        ) : (
          '—'
        )}
      </td>
    </tr>
  );
}
