/**
 * Repository search with a fallback for the undocumented `/api/search/v4`
 * (RISKS.md 1.3, docs/API.md section A).
 *
 * v4 first. If its body fails `SearchV4ResponseSchema` (Docker Hub changed the
 * shape), we make one call to the legacy `/v2/search/repositories/` and
 * normalize it into the same `Page<RepoSummary>`, with `source: 'legacy'` so
 * the UI can say results are limited (no logos, dates or platforms).
 *
 * The legacy endpoint has no badge filter and returns nothing for an empty
 * query, so it can't stand in for "popular" or a badge-filtered search: those
 * rethrow the v4 `bad_payload`, and `getCached` serves stale data or a 503 as
 * usual. It has no sort either, but relevance-ordered results beat a 503 for a
 * sorted query, so `sort` is dropped and the UI must use `source` to say the
 * results are limited and unsorted. Any other failure (404, 429, 5xx, non-JSON, budget) is
 * rethrown as is: the legacy endpoint is on the same host and would fail too.
 *
 * Callers wrap these in `getCached` (`upstream.server.ts`); both upstream
 * calls take a budget slot. `getSearchPage` does that for `GET /api/search`'s
 * cache key, and `loadSearchPage` is the results page's (`/search`) loader.
 */
import type { Page, RepoSummary, SearchPage } from '../lib/dto';
import type { SearchQuery } from '../lib/params';
import { parseSearchUrl, toSearchQuery, type SearchPageData } from '../lib/search-query';
import { cacheKey } from './api.server';
import { config } from './config.server';
import { dockerHub, isSchemaMismatch, type DockerHubClient } from './dockerhub.server';
import { LegacySearchResponseSchema, SearchV4ResponseSchema } from './dockerhub.schemas.server';
import { toLegacySearchPage, toSearchPage } from './normalize.server';
import { toPageErrorResponse } from './pageError.server';
import { enforceRateLimit } from './rateLimit.server';
import { getCached, type Cached } from './upstream.server';

export type SearchSource = 'v4' | 'legacy';

export interface SearchResult {
  page: Page<RepoSummary>;
  /**
   * `legacy` when v4 failed its schema and the fallback answered: no logos,
   * dates or platforms, and `sort` was ignored (relevance order).
   */
  source: SearchSource;
}

/** Suggestions page size: Docker Hub's suggestions endpoint returns 10. */
export const SUGGESTIONS_PAGE_SIZE = 10;

/** Whether the legacy endpoint can answer this query faithfully. */
export function canFallBack(query: Pick<SearchQuery, 'q' | 'badge'>): boolean {
  return query.q.trim() !== '' && query.badge === undefined;
}

/** Logs the drift server-side: endpoint and path only, never upstream values. */
function warnFallback(endpoint: string, issuePath: string): void {
  console.warn(
    `[search] Docker Hub ${endpoint} failed its schema at ${issuePath}; falling back to /v2/search/repositories`,
  );
}

async function legacy(
  client: DockerHubClient,
  query: Pick<SearchQuery, 'q' | 'page' | 'pageSize'>,
): Promise<SearchResult> {
  const { q, page, pageSize } = query;
  const body = await client.get(
    { endpoint: 'legacySearch', query: { q, page, pageSize } },
    LegacySearchResponseSchema,
  );
  return { source: 'legacy', page: toLegacySearchPage(body, { page, pageSize }) };
}

/** `/api/search` and `/api/popular`: v4, falling back to legacy search on a schema mismatch. */
export async function searchRepositories(
  client: DockerHubClient,
  query: SearchQuery,
): Promise<SearchResult> {
  try {
    const body = await client.get({ endpoint: 'search', query }, SearchV4ResponseSchema);
    return { source: 'v4', page: toSearchPage(body, query) };
  } catch (error) {
    if (!isSchemaMismatch(error) || !canFallBack(query)) throw error;
    warnFallback('search', error.issuePath);
    return legacy(client, query);
  }
}

/** Autocomplete: v4 suggestions, falling back to the first legacy page on a schema mismatch. */
export async function suggestRepositories(
  client: DockerHubClient,
  q: string,
): Promise<SearchResult> {
  const paging = { page: 1, pageSize: SUGGESTIONS_PAGE_SIZE };
  try {
    const body = await client.get({ endpoint: 'suggestions', q }, SearchV4ResponseSchema);
    return { source: 'v4', page: toSearchPage(body, paging) };
  } catch (error) {
    if (!isSchemaMismatch(error) || !canFallBack({ q })) throw error;
    warnFallback('suggestions', error.issuePath);
    return legacy(client, { q, ...paging });
  }
}

/**
 * The cache key of one search, shared by `GET /api/search` and the results
 * page (`/search`), so the same query reads one entry whichever asks
 * (CLAUDE.md hard rule 3). Every part comes from the validated query.
 */
export const searchCacheKey = ({ q, page, pageSize, sort, badge }: SearchQuery) =>
  cacheKey('search', q, page, pageSize, sort, badge);

/**
 * One page of search results through the cache (`getCached`), with the legacy
 * fallback. Throws `UpstreamUnavailableError` when nothing is cached and
 * Docker Hub is failing or the budget is spent.
 */
export function getSearchPage(query: SearchQuery): Promise<Cached<SearchPage>> {
  return getCached(searchCacheKey(query), config.cache.ttlSeconds.search, async () => {
    const result = await searchRepositories(dockerHub, query);
    return { ...result.page, source: result.source };
  });
}

/**
 * The results page's loader (`/search`, questionnaire B12, B13, E28):
 *
 * 1. counts the request against the per-client rate limit;
 * 2. reads `q`, `sort`, `badge` and `page` from the URL (`parseSearchUrl`),
 *    leniently: an invalid value falls back to its default instead of a 400,
 *    and `page` never passes Docker Hub's anonymous 1000-result cap;
 * 3. reads the page through the cache shared with `GET /api/search`. A stale
 *    copy comes back with `degraded: true`; Docker Hub failing with nothing
 *    cached is thrown as a page error (`toPageErrorResponse`, 503) for the
 *    root `ErrorBoundary`, as is the per-client limit (429).
 */
export async function loadSearchPage({ request }: { request: Request }): Promise<SearchPageData> {
  try {
    enforceRateLimit(request);
    const url = parseSearchUrl(new URL(request.url).searchParams);
    const result = await getSearchPage(toSearchQuery(url));
    return { ...url, results: result.value, degraded: result.degraded };
  } catch (error) {
    throw toPageErrorResponse(error);
  }
}
