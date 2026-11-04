/**
 * The Tags tab's URL state and paging rules (questionnaire B12, B13, D23, E28).
 * Client-safe: the tab's loader (`app/server/tags.server.ts`) and its
 * component both read the URL through here.
 *
 * URL: `/r/{ns}/{repo}/tags?name=&ordering=` (`/_/{repo}/tags` for official
 * images). Defaults are left out of the URL. "Load more" asks the same route
 * for `&page=N` through a fetcher; `page` never appears in the address bar.
 */
import * as v from 'valibot';

import type { Page, Tag } from './dto';
import {
  ANONYMOUS_RESULTS_MAX,
  PageSchema,
  TagFilterSchema,
  TagOrderingSchema,
  searchParamsToObject,
  type TagOrdering,
} from './params';
import type { ErrorKind } from './route-error';

/** Tags per page, first page and each "Load more" (the issue asks for 25-50). */
export const TAGS_PAGE_SIZE = 50;
/** Highest page "Load more" can reach: Docker Hub serves only the first 1000 results anonymously. */
export const TAGS_PAGE_MAX = Math.floor(ANONYMOUS_RESULTS_MAX / TAGS_PAGE_SIZE);
/** Newest first, as Docker Hub lists tags without an `ordering`. */
export const DEFAULT_TAG_ORDERING: TagOrdering = 'last_updated';
/** Pause after the last keystroke before the name filter updates the URL. */
export const TAG_FILTER_DEBOUNCE_MS = 300;

/** What the URL says the tab shows. */
export interface TagsUrlState {
  ordering: TagOrdering;
  /** The name filter, trimmed; `''` for none. May be invalid (see `isValidTagFilter`). */
  name: string;
}

export interface ParsedTagsUrl extends TagsUrlState {
  /** 1-based; an invalid or out-of-range `page` reads as 1. */
  page: number;
}

/** True when `name` can be sent upstream as a tag filter (`TagFilterSchema`). */
export function isValidTagFilter(name: string): boolean {
  return v.is(TagFilterSchema, name);
}

/**
 * Reads the tab's state from a query string. Lenient, since it's a page URL
 * people can edit: an unknown `ordering` falls back to the default, a `page`
 * past the anonymous cap reads as 1. The first value of a repeated key wins
 * and empty values count as missing (`searchParamsToObject`).
 */
export function parseTagsUrl(params: URLSearchParams): ParsedTagsUrl {
  const raw = searchParamsToObject(params);
  const ordering = v.is(TagOrderingSchema, raw.ordering) ? raw.ordering : DEFAULT_TAG_ORDERING;
  const name = (raw.name ?? '').trim();
  const page = v.safeParse(PageSchema, raw.page);
  return {
    ordering,
    name,
    page: page.success && page.output <= TAGS_PAGE_MAX ? page.output : 1,
  };
}

/** The tab's query string (`?name=…&ordering=…&page=…`), defaults left out; `''` for all defaults. */
export function tagsSearch({ ordering, name }: TagsUrlState, page = 1): string {
  const params = new URLSearchParams();
  if (name) params.set('name', name);
  if (ordering !== DEFAULT_TAG_ORDERING) params.set('ordering', ordering);
  if (page > 1) params.set('page', String(page));
  const search = params.toString();
  return search ? `?${search}` : '';
}

/** The Tags tab's URL under `basePath` (`repoPath(ns, repo)`). */
export function tagsHref(basePath: string, state: TagsUrlState, page = 1): string {
  return `${basePath}/tags${tagsSearch(state, page)}`;
}

// ---------------------------------------------------------------------------
// Sorting
// ---------------------------------------------------------------------------

/** The sortable columns. Size isn't: Docker Hub can't order by it. */
export type TagSortColumn = 'name' | 'last_updated';
export type SortDirection = 'ascending' | 'descending';

/**
 * Docker Hub's `ordering` is the reverse of the usual convention for both
 * fields (checked live 2026-11-04, docs/API.md): `name` lists Z→A and
 * `-name` A→Z; `last_updated` lists newest first and `-last_updated` oldest first.
 */
const ORDERINGS: Record<TagSortColumn, Record<SortDirection, TagOrdering>> = {
  name: { ascending: '-name', descending: 'name' },
  last_updated: { ascending: '-last_updated', descending: 'last_updated' },
};

/** Where a column starts on its first click: names A→Z, dates newest first. */
const FIRST_DIRECTION: Record<TagSortColumn, SortDirection> = {
  name: 'ascending',
  last_updated: 'descending',
};

/** `column`'s direction under `ordering`, or `undefined` when the list isn't sorted by it. */
export function sortDirection(
  column: TagSortColumn,
  ordering: TagOrdering,
): SortDirection | undefined {
  const { ascending, descending } = ORDERINGS[column];
  if (ordering === ascending) return 'ascending';
  if (ordering === descending) return 'descending';
  return undefined;
}

/** The `ordering` a click on `column`'s header asks for: the other direction if it's the current sort, else its first one. */
export function nextOrdering(column: TagSortColumn, current: TagOrdering): TagOrdering {
  const direction = sortDirection(column, current);
  if (direction === undefined) return ORDERINGS[column][FIRST_DIRECTION[column]];
  return ORDERINGS[column][direction === 'ascending' ? 'descending' : 'ascending'];
}

// ---------------------------------------------------------------------------
// Paging
// ---------------------------------------------------------------------------

/**
 * The page "Load more" fetches after `last` (the latest page loaded), or
 * `null` when there's none: the list is complete, the last page came back
 * empty, or the next one is past Docker Hub's anonymous 1000-result cap.
 */
export function nextTagsPage(last: Pick<Page<Tag>, 'items' | 'total' | 'page' | 'pageSize'>) {
  if (last.items.length === 0) return null;
  if (last.page * last.pageSize >= last.total) return null;
  const next = last.page + 1;
  return next * last.pageSize <= ANONYMOUS_RESULTS_MAX ? next : null;
}

/** True when Docker Hub has more tags than we may page through anonymously. */
export function isPastAnonymousCap(total: number): boolean {
  return total > ANONYMOUS_RESULTS_MAX;
}

// ---------------------------------------------------------------------------
// Loader data
// ---------------------------------------------------------------------------

/** Why a page of tags couldn't load. Shown in the tab, not by the route error boundary. */
export type TagsErrorKind = Extract<
  ErrorKind,
  'repo_not_found' | 'unavailable' | 'rate_limited' | 'unexpected'
>;

export type TagsResult =
  | {
      ok: true;
      tags: Page<Tag>;
      /** A stale copy: show the degraded banner (ADR-0003). */
      degraded: boolean;
    }
  | {
      ok: false;
      error: TagsErrorKind;
      /** Whole seconds, when the server knows when to retry. */
      retryAfterSeconds?: number;
    };

/**
 * What the Tags tab's loader returns, for the first page and for each "Load
 * more" fetch. It echoes the query, so the tab can drop a fetch that answers
 * for a sort or filter it no longer shows.
 */
export interface TagsTabData extends ParsedTagsUrl {
  result: TagsResult;
}
