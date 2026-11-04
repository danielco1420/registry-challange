/**
 * The search results page's URL state and paging rules (questionnaire B12,
 * B13, E28). Client-safe: the page's loader (`loadSearchPage` in
 * `app/server/search.server.ts`) and its component both read the URL through here.
 *
 * URL: `/search?q=&sort=&badge=&page=`. Defaults are left out of the URL.
 */
import * as v from 'valibot';

import type { SearchPage } from './dto';
import {
  ANONYMOUS_RESULTS_MAX,
  BadgeSchema,
  PAGE_SIZE_DEFAULT,
  PageSchema,
  QUERY_MAX_LENGTH,
  QuerySchema,
  SearchSortSchema,
  searchParamsToObject,
  type BadgeFilter,
  type SearchQuery,
  type SearchSort,
} from './params';

/** The results page's path; the search bar's form submits `q` here. */
export const SEARCH_PATH = '/search';
/** Results per page: the `/api/search` default, so the page and the API share cache entries. */
export const SEARCH_PAGE_SIZE = PAGE_SIZE_DEFAULT;
/** Highest page we link to: Docker Hub serves only the first 1000 results anonymously. */
export const SEARCH_PAGE_MAX = Math.floor(ANONYMOUS_RESULTS_MAX / SEARCH_PAGE_SIZE);
export const DEFAULT_SEARCH_SORT: SearchSort = 'relevance';

/** What the URL says the page shows, apart from the page number. */
export interface SearchUrlState {
  /** Trimmed; `''` browses everything (Docker Hub's empty-query mode). */
  q: string;
  sort: SearchSort;
  /** `undefined` for no badge filter. */
  badge?: BadgeFilter;
}

export interface ParsedSearchUrl extends SearchUrlState {
  /** 1-based; an invalid page or one past `SEARCH_PAGE_MAX` reads as 1. */
  page: number;
}

// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u001f\u007f-\u009f]/g;

/**
 * `q` as the search schema accepts it: control characters become spaces, then
 * it's trimmed and cut to `QUERY_MAX_LENGTH` without splitting a character.
 */
export function cleanQuery(raw: string): string {
  const parsed = v.safeParse(QuerySchema, raw);
  if (parsed.success) return parsed.output;

  const spaced = raw.replace(CONTROL_CHARS, ' ').trim();
  let out = '';
  for (const char of spaced) {
    if (out.length + char.length > QUERY_MAX_LENGTH) break;
    out += char;
  }
  out = out.trim();
  // Never hand back something the schema would still reject.
  return v.is(QuerySchema, out) ? out : '';
}

/**
 * Reads the page's state from a query string. Lenient, since it's a page URL
 * people can edit: an unknown `sort` falls back to relevance, an unknown
 * `badge` to no filter, an invalid `page` or one past the anonymous cap to 1,
 * and an over-long `q` is cut (`cleanQuery`). The first value of a repeated
 * key wins and empty values count as missing (`searchParamsToObject`).
 */
export function parseSearchUrl(params: URLSearchParams): ParsedSearchUrl {
  const raw = searchParamsToObject(params);
  const q = cleanQuery(raw.q ?? '');
  const sort = v.is(SearchSortSchema, raw.sort) ? raw.sort : DEFAULT_SEARCH_SORT;
  const badge = v.is(BadgeSchema, raw.badge) ? raw.badge : undefined;
  const page = v.safeParse(PageSchema, raw.page);
  const state: ParsedSearchUrl = {
    q,
    sort,
    page: page.success && page.output <= SEARCH_PAGE_MAX ? page.output : 1,
  };
  if (badge !== undefined) state.badge = badge;
  return state;
}

/** The upstream query for a parsed URL: always `SEARCH_PAGE_SIZE` per page. */
export function toSearchQuery({ q, sort, badge, page }: ParsedSearchUrl): SearchQuery {
  return { q, sort, badge, page, pageSize: SEARCH_PAGE_SIZE };
}

/**
 * The results page's URL, defaults left out. Leave `page` out (the default)
 * whenever the query, sort or filter changes, so the new results start on page 1.
 */
export function searchHref({ q, sort, badge }: SearchUrlState, page = 1): string {
  const params = new URLSearchParams();
  if (q) params.set('q', q);
  if (sort !== DEFAULT_SEARCH_SORT) params.set('sort', sort);
  if (badge) params.set('badge', badge);
  if (page > 1) params.set('page', String(page));
  const search = params.toString();
  return search ? `${SEARCH_PATH}?${search}` : SEARCH_PATH;
}

/** True when a filter other than the query is set (the sort or a badge), i.e. "Clear filters" would change something. */
export function hasFilters({ sort, badge }: SearchUrlState): boolean {
  return sort !== DEFAULT_SEARCH_SORT || badge !== undefined;
}

// ---------------------------------------------------------------------------
// Paging
// ---------------------------------------------------------------------------

/** The last page we link to for `total` results: at least 1, at most `SEARCH_PAGE_MAX`. */
export function lastSearchPage(total: number, pageSize = SEARCH_PAGE_SIZE): number {
  const pages = Math.ceil(Math.max(0, total) / pageSize);
  return Math.min(Math.max(1, pages), Math.floor(ANONYMOUS_RESULTS_MAX / pageSize));
}

/** True when Docker Hub has more results than we may page through anonymously. */
export function isPastAnonymousCap(total: number): boolean {
  return total > ANONYMOUS_RESULTS_MAX;
}

/** What the results page's loader returns. It echoes the URL state it read. */
export interface SearchPageData extends ParsedSearchUrl {
  results: SearchPage;
  /** A stale copy: show the degraded banner (ADR-0003). */
  degraded: boolean;
}

export type PaginationItem = number | 'ellipsis-start' | 'ellipsis-end';

/**
 * The numbered links to show: always the first and last page, the current page
 * with `siblings` pages either side, and an ellipsis for each gap of more than
 * one page (a gap of exactly one shows that page instead).
 *
 * `paginationRange(6, 40)` is `[1, 'ellipsis-start', 5, 6, 7, 'ellipsis-end', 40]`.
 */
export function paginationRange(current: number, last: number, siblings = 1): PaginationItem[] {
  if (last <= 1) return [1];
  const page = Math.min(Math.max(1, current), last);
  let start = Math.max(2, page - siblings);
  let end = Math.min(last - 1, page + siblings);
  // A gap of one page is that page, not an ellipsis.
  if (start === 3) start = 2;
  if (end === last - 2) end = last - 1;

  const items: PaginationItem[] = [1];
  if (start > 2) items.push('ellipsis-start');
  for (let n = start; n <= end; n += 1) items.push(n);
  if (end < last - 1) items.push('ellipsis-end');
  items.push(last);
  return items;
}
