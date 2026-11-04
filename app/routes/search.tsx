import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigation, useRevalidator } from 'react-router';

import { RepoCard } from '~/components/repo/repo-card';
import { DegradedBanner } from '~/components/state/degraded-banner';
import { Empty } from '~/components/state/empty';
import { Loading } from '~/components/state/loading';
import { buttonVariants } from '~/components/ui/button';
import i18next from '~/i18n/i18next';
import type { SearchPage } from '~/lib/dto';
import { formatNumber } from '~/lib/format';
import { ANONYMOUS_RESULTS_MAX, BADGES, SEARCH_SORTS, type BadgeFilter } from '~/lib/params';
import {
  DEFAULT_SEARCH_SORT,
  SEARCH_PATH,
  hasFilters,
  isPastAnonymousCap,
  lastSearchPage,
  paginationRange,
  searchHref,
  type SearchUrlState,
} from '~/lib/search-query';
import { cn } from '~/lib/utils';
import { loadSearchPage } from '~/server/search.server';

import type { Route } from './+types/search';

/**
 * The search results page (questionnaire B12, B13, E28): `/search?q=&sort=&badge=&page=`.
 * Every part of the view lives in the URL, so a search can be shared and
 * Back/Forward steps through it. The sort and badge filters are links that
 * leave `page` out, so changing either starts on page 1; without JavaScript
 * they work the same way. Numbered pages stop at Docker Hub's anonymous
 * 1000-result cap (`SEARCH_PAGE_MAX`).
 *
 * Docker Hub failing with nothing cached, or the per-client limit, is thrown
 * as a page error and shown by the root `ErrorBoundary` (the header's search
 * box stays); a stale copy shows the degraded banner.
 */
export function loader({ request }: Route.LoaderArgs) {
  return loadSearchPage({ request });
}

export function meta({ data }: Route.MetaArgs) {
  const brand = i18next.t('brand.name');
  if (!data?.q) return [{ title: i18next.t('search.results.meta.titleAll', { brand }) }];
  return [{ title: i18next.t('search.results.meta.title', { query: data.q, brand }) }];
}

export default function SearchResults({ loaderData }: Route.ComponentProps) {
  const { t } = useTranslation();
  const revalidator = useRevalidator();
  const navigation = useNavigation();
  const { q, sort, badge, page, results, degraded } = loaderData;
  const state: SearchUrlState = { q, sort, badge };

  // Another page, sort, filter or query is loading: keep the results, marked busy.
  const updating = navigation.state === 'loading' && navigation.location?.pathname === SEARCH_PATH;

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <h1 className="text-2xl font-semibold break-words text-foreground">
        {q ? t('search.results.title', { query: q }) : t('search.results.titleAll')}
      </h1>

      <div className="flex flex-col gap-3">
        <FilterGroup
          label={t('search.results.sort.label')}
          options={SEARCH_SORTS.map((value) => ({
            key: value,
            label: t(`search.results.sort.${value}`),
            href: searchHref({ ...state, sort: value }),
            current: value === sort,
          }))}
        />
        <FilterGroup
          label={t('search.results.badge.label')}
          options={[undefined, ...BADGES].map((value: BadgeFilter | undefined) => ({
            key: value ?? 'all',
            label: t(`search.results.badge.${value ?? 'all'}`),
            href: searchHref({ ...state, badge: value }),
            current: value === badge,
          }))}
        />
      </div>

      {degraded && <DegradedBanner retry={() => void revalidator.revalidate()} />}
      {results.source === 'legacy' && <LegacyNotice />}
      {updating && <Loading label={t('search.results.loading')} className="py-2" />}

      <div aria-busy={updating || undefined} className={updating ? 'opacity-60' : undefined}>
        <ResultsView state={state} page={page} results={results} />
      </div>
    </div>
  );
}

interface FilterOption {
  key: string;
  label: string;
  href: string;
  current: boolean;
}

/**
 * A labelled row of links, one per value, the current one marked with
 * `aria-current`. Links rather than a form, so each choice is its own URL
 * (Back/Forward, no JavaScript needed) and never carries `page`.
 */
function FilterGroup({ label, options }: { label: string; options: FilterOption[] }) {
  const labelId = useId();
  return (
    <div role="group" aria-labelledby={labelId} className="flex flex-wrap items-center gap-2">
      <span id={labelId} className="w-16 shrink-0 text-sm font-medium text-muted-foreground">
        {label}
      </span>
      <ul className="flex flex-wrap gap-2">
        {options.map((option) => (
          <li key={option.key}>
            <Link
              to={option.href}
              aria-current={option.current ? 'true' : undefined}
              className={buttonVariants({
                variant: option.current ? 'default' : 'outline',
                size: 'sm',
              })}
            >
              {option.label}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Docker Hub's v4 search failed its schema and the legacy search answered (`source: 'legacy'`). */
function LegacyNotice() {
  const { t } = useTranslation();
  return (
    <p className="rounded-md border border-border bg-secondary px-4 py-3 text-sm text-secondary-foreground">
      <strong className="font-semibold">{t('search.results.legacy.title')}</strong>{' '}
      {t('search.results.legacy.description')}
    </p>
  );
}

/** The results, or an empty state: no results at all, or a page past the last one. */
function ResultsView({
  state,
  page,
  results,
}: {
  state: SearchUrlState;
  page: number;
  results: SearchPage;
}) {
  const { t } = useTranslation();
  const { items, total, pageSize } = results;

  if (items.length === 0 && page > 1 && total > 0) {
    return (
      <Empty
        title={t('search.results.pastEnd.title')}
        description={t('search.results.pastEnd.description')}
        action={
          <Link to={searchHref(state)} className={buttonVariants({ variant: 'outline' })}>
            {t('search.results.pastEnd.action')}
          </Link>
        }
      />
    );
  }

  if (items.length === 0) {
    const filtered = hasFilters(state);
    return (
      <Empty
        title={
          state.q
            ? t('search.results.empty.title', { query: state.q })
            : t('search.results.empty.titleAll')
        }
        description={
          filtered
            ? t('search.results.empty.descriptionFiltered')
            : t('search.results.empty.description')
        }
        action={
          filtered ? (
            <Link
              to={searchHref({ q: state.q, sort: DEFAULT_SEARCH_SORT })}
              className={buttonVariants({ variant: 'outline' })}
            >
              {t('search.results.empty.clearFilters')}
            </Link>
          ) : (
            <Link to="/" className={buttonVariants({ variant: 'outline' })}>
              {t('state.actions.backToExplore')}
            </Link>
          )
        }
      />
    );
  }

  const last = lastSearchPage(total, pageSize);
  const from = (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground" aria-live="polite">
        {total > pageSize
          ? t('search.results.range', {
              from: formatNumber(from),
              to: formatNumber(Math.max(from, to)),
              total: formatNumber(total),
            })
          : t('search.results.count', { count: total, total: formatNumber(total) })}
      </p>

      <ul className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
        {items.map((repo) => (
          <li key={repo.id} className="flex">
            <RepoCard repo={repo} headingLevel={2} className="w-full" />
          </li>
        ))}
      </ul>

      <Pagination state={state} page={page} last={last} />

      {isPastAnonymousCap(total) && (
        <p className="text-center text-sm text-muted-foreground">
          {t('search.results.capped', { max: formatNumber(ANONYMOUS_RESULTS_MAX) })}
        </p>
      )}
    </div>
  );
}

const PAGE_LINK = 'min-w-9';

/**
 * Numbered pages (questionnaire B12): Previous, the first and last page, the
 * current one with a neighbour either side and ellipses between, then Next.
 * Hidden when everything fits on one page.
 */
function Pagination({ state, page, last }: { state: SearchUrlState; page: number; last: number }) {
  const { t } = useTranslation();
  if (last <= 1) return null;

  const disabled = cn(
    buttonVariants({ variant: 'outline', size: 'sm' }),
    'pointer-events-none opacity-50',
  );

  return (
    <nav aria-label={t('search.results.pagination.label')} className="mt-2">
      <ul className="flex flex-wrap items-center justify-center gap-1">
        <li>
          {page > 1 ? (
            <Link
              to={searchHref(state, page - 1)}
              rel="prev"
              className={buttonVariants({ variant: 'outline', size: 'sm' })}
            >
              {t('search.results.pagination.previous')}
            </Link>
          ) : (
            <span aria-disabled="true" className={disabled}>
              {t('search.results.pagination.previous')}
            </span>
          )}
        </li>

        {paginationRange(page, last).map((item) =>
          typeof item === 'number' ? (
            <li key={item}>
              <Link
                to={searchHref(state, item)}
                aria-label={t('search.results.pagination.page', { page: item })}
                aria-current={item === page ? 'page' : undefined}
                className={cn(
                  buttonVariants({ variant: item === page ? 'default' : 'ghost', size: 'sm' }),
                  PAGE_LINK,
                )}
              >
                {formatNumber(item)}
              </Link>
            </li>
          ) : (
            <li key={item} aria-hidden="true" className="px-1 text-muted-foreground">
              …
            </li>
          ),
        )}

        <li>
          {page < last ? (
            <Link
              to={searchHref(state, page + 1)}
              rel="next"
              className={buttonVariants({ variant: 'outline', size: 'sm' })}
            >
              {t('search.results.pagination.next')}
            </Link>
          ) : (
            <span aria-disabled="true" className={disabled}>
              {t('search.results.pagination.next')}
            </span>
          )}
        </li>
      </ul>
    </nav>
  );
}
