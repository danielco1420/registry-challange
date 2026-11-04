/**
 * The 10 most popular official images (docs/API.md, "Popular 10"), shared by
 * `GET /api/popular` and the Explore page loader (`app/routes/home.tsx`), so
 * both read the same cache entry with the same value shape, and a page view
 * never costs a second upstream call (CLAUDE.md hard rule 3).
 */
import type { SearchPage } from '../lib/dto';
import type { SearchQuery } from '../lib/params';
import { cacheKey } from './api.server';
import { config } from './config.server';
import { dockerHub } from './dockerhub.server';
import { toPageErrorResponse } from './pageError.server';
import { enforceRateLimit } from './rateLimit.server';
import { searchRepositories } from './search.server';
import { getCached, type Cached } from './upstream.server';

/** The 10 most pulled official images. */
export const POPULAR_QUERY: SearchQuery = {
  q: '',
  page: 1,
  pageSize: 10,
  sort: 'pulls',
  badge: 'official',
};

/** The cache key of the popular images. */
export const popularCacheKey = () => cacheKey('popular');

/** The popular images from Docker Hub (v4 search, v2 fallback). */
export async function loadPopular(): Promise<SearchPage> {
  const { page, source } = await searchRepositories(dockerHub, POPULAR_QUERY);
  return { ...page, source };
}

/**
 * The popular images through the cache (`getCached`). Throws
 * `UpstreamUnavailableError` when nothing is cached and Docker Hub is failing
 * or the budget is spent.
 */
export function getPopular(): Promise<Cached<SearchPage>> {
  return getCached(popularCacheKey(), config.cache.ttlSeconds.popular, loadPopular);
}

/** What the Explore page's loader returns. */
export interface ExplorePageData {
  popular: SearchPage;
  /** The data is a stale copy: show the degraded banner (ADR-0003). */
  degraded: boolean;
}

/**
 * The Explore page's loader (`/`): counts the request against the per-client
 * rate limit, then reads the popular images through the cache shared with
 * `/api/popular`. Docker Hub failing with nothing cached is "Docker Hub
 * unavailable" (503) and the per-client limit "Too many requests" (429), both
 * shown by the root `ErrorBoundary`; a stale copy comes back with
 * `degraded: true`.
 */
export async function loadExplorePage({ request }: { request: Request }): Promise<ExplorePageData> {
  try {
    enforceRateLimit(request);
    const result = await getPopular();
    return { popular: result.value, degraded: result.degraded };
  } catch (error) {
    throw toPageErrorResponse(error);
  }
}
