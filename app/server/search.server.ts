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
 * calls take a budget slot.
 */
import type { Page, RepoSummary } from '../lib/dto';
import type { SearchQuery } from '../lib/params';
import { isSchemaMismatch, type DockerHubClient } from './dockerhub.server';
import { LegacySearchResponseSchema, SearchV4ResponseSchema } from './dockerhub.schemas.server';
import { toLegacySearchPage, toSearchPage } from './normalize.server';

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
