/**
 * `getCached`: the one way routes and loaders read Docker Hub data
 * (ADR-0003, RISKS 1.1, 1.2, 1.4, 1.6).
 *
 * It wires the cache (`cache.server.ts`), the upstream client
 * (`dockerhub.server.ts`) and the proxy-wide budget (`budget.server.ts`):
 *
 * - The cache calls `fetcher` at most once per key at a time, so cache hits and
 *   single-flight followers never reach Docker Hub or the budget. The client
 *   takes a budget slot for each attempt it sends, retries included.
 * - **Fresh or just fetched:** `{ status: 'HIT' | 'MISS', degraded: false }`.
 * - **Stale entry:** served at once while one background refresh runs.
 *   `degraded` is true when that entry's last refresh failed or the budget is
 *   exhausted (the refresh can't run), so the UI shows the degraded banner. A
 *   routine stale-while-revalidate read on a healthy upstream isn't degraded.
 * - **No entry and the fetch fails** (budget exhausted, 429, 5xx, timeout,
 *   bad payload): throws `UpstreamUnavailableError`; `upstreamUnavailableResponse`
 *   turns it into the 503. A 404 (`UpstreamError` of kind `not_found`) and
 *   programming errors are rethrown unchanged.
 *
 * Usage from a resource route (T13):
 *
 * ```ts
 * try {
 *   const result = await getCached(`repo:${ns}/${repo}`, ttl.repo, () =>
 *     dockerHub.get({ endpoint: 'repository', params }, RepoSchema),
 *   );
 *   return cachedJson(toDto(result.value), result, ttl.repo);
 * } catch (error) {
 *   if (error instanceof UpstreamUnavailableError) return upstreamUnavailableResponse(error);
 *   throw error;
 * }
 * ```
 *
 * A page loader returns `result.degraded` alongside its data for the banner.
 */
import { upstreamBudget, type UpstreamBudget } from './budget.server';
import { cache as sharedCache, type CacheResult, type CacheStatus } from './cache.server';
import { UpstreamError } from './dockerhub.server';

/**
 * `Retry-After` for a 503 caused by an upstream failure that sent no
 * `Retry-After` of its own, while the budget still has room.
 */
export const UNAVAILABLE_RETRY_AFTER_FALLBACK_SECONDS = 5;

export interface Cached<T> {
  value: T;
  /** For the `X-Cache` header. */
  status: CacheStatus;
  /** Milliseconds since the value was fetched, for the `Age` header. */
  ageMs: number;
  /** True when the value is stale because Docker Hub is failing or the budget is spent. */
  degraded: boolean;
}

export type UnavailableReason = 'budget_exhausted' | 'upstream_failed';

/** No usable data: no cache entry, and the upstream call failed or wasn't allowed. */
export class UpstreamUnavailableError extends Error {
  override name = 'UpstreamUnavailableError';
  readonly reason: UnavailableReason;
  /** Whole seconds, at least 1, for the `Retry-After` header. */
  readonly retryAfterSeconds: number;

  constructor(reason: UnavailableReason, retryAfterSeconds: number, options?: ErrorOptions) {
    super(
      reason === 'budget_exhausted'
        ? 'Upstream budget exhausted and no cached data'
        : 'Docker Hub is failing and no cached data',
      options,
    );
    this.reason = reason;
    this.retryAfterSeconds = Math.max(1, Math.ceil(retryAfterSeconds));
  }
}

export interface GetCachedDeps {
  cache: {
    get<T>(
      key: string,
      options: { ttlMs: number },
      fetcher: () => Promise<T>,
    ): Promise<CacheResult<T>>;
  };
  budget: Pick<UpstreamBudget, 'isExhausted' | 'retryAfterSeconds'>;
}

export type GetCached = <T>(
  key: string,
  ttlSeconds: number,
  fetcher: () => Promise<T>,
) => Promise<Cached<T>>;

/** Maps a failed fetch with no cache entry to `UpstreamUnavailableError`, or returns it unchanged. */
function toUnavailable(error: unknown, budget: GetCachedDeps['budget']): unknown {
  if (!(error instanceof UpstreamError) || error.kind === 'not_found') return error;
  if (error.kind === 'budget_exhausted') {
    return new UpstreamUnavailableError(
      'budget_exhausted',
      error.retryAfterSeconds ?? budget.retryAfterSeconds(),
      { cause: error },
    );
  }
  // A retry refused by the budget surfaces the upstream error, so also wait for a free slot.
  const retryAfter = Math.max(
    error.retryAfterSeconds ?? UNAVAILABLE_RETRY_AFTER_FALLBACK_SECONDS,
    budget.retryAfterSeconds(),
  );
  return new UpstreamUnavailableError('upstream_failed', retryAfter, { cause: error });
}

export function createGetCached({ cache, budget }: GetCachedDeps): GetCached {
  return async function getCached<T>(
    key: string,
    ttlSeconds: number,
    fetcher: () => Promise<T>,
  ): Promise<Cached<T>> {
    // Sampled before `cache.get`: a stale read starts its refresh before we
    // resume, and a refresh that takes the last slot is healthy, not degraded.
    const exhaustedBefore = budget.isExhausted();
    let result: CacheResult<T>;
    try {
      result = await cache.get(key, { ttlMs: ttlSeconds * 1000 }, fetcher);
    } catch (error) {
      throw toUnavailable(error, budget);
    }
    return {
      value: result.value,
      status: result.status,
      ageMs: result.ageMs,
      degraded: result.isStale && (result.refreshFailed || exhaustedBefore),
    };
  };
}

/**
 * Reads `key` through the shared cache, calling `fetcher` (a `dockerHub.get`
 * call) only on a miss or a background refresh. `ttlSeconds` comes from
 * `config.cache.ttlSeconds`. Callers keep one value type per key.
 */
export const getCached: GetCached = createGetCached({ cache: sharedCache, budget: upstreamBudget });

/**
 * A JSON response for data from `getCached`, with `X-Cache` and `Age`:
 * - `HIT` / `MISS`: `Cache-Control: public, max-age=<ttlSeconds>`; with `Age`,
 *   downstream caches keep it only for what's left of the TTL;
 * - `STALE`: `Cache-Control: no-store`, so downstream caches don't keep it.
 *
 * `data` is what the client gets (usually a DTO built from `result.value`).
 * `status` is 200 except for a cached "not found" answer (404).
 */
export function cachedJson(
  data: unknown,
  result: Pick<Cached<unknown>, 'status' | 'ageMs'>,
  ttlSeconds: number,
  status = 200,
): Response {
  const headers = new Headers({
    'X-Cache': result.status,
    Age: String(Math.max(0, Math.floor(result.ageMs / 1000))),
    'Cache-Control':
      result.status === 'STALE'
        ? 'no-store'
        : `public, max-age=${Math.max(0, Math.floor(ttlSeconds))}`,
  });
  return Response.json(data, { status, headers });
}

export interface UpstreamUnavailableBody {
  error: {
    code: 'upstream_unavailable';
    message: string;
  };
}

/** The `503 Service Unavailable` JSON response with `Retry-After`. Never cached. */
export function upstreamUnavailableResponse(
  error: Pick<UpstreamUnavailableError, 'retryAfterSeconds'>,
): Response {
  const body: UpstreamUnavailableBody = {
    error: {
      code: 'upstream_unavailable',
      message: 'Docker Hub is unavailable right now. Try again later.',
    },
  };
  return Response.json(body, {
    status: 503,
    headers: {
      'Retry-After': String(Math.max(1, Math.ceil(error.retryAfterSeconds))),
      'Cache-Control': 'no-store',
    },
  });
}
