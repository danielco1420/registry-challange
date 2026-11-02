import { config } from './config.server';

/**
 * In-memory server cache (ADR-0003, RISKS 1.1, 1.2, 2.6).
 *
 * - **LRU**: at most `maxEntries` values; reading or writing a key makes it the
 *   most recent, and the least recent entry is evicted past the bound.
 * - **Single-flight**: concurrent callers for one key share one in-flight fetch,
 *   whether it is a miss or a background refresh.
 * - **Stale-while-revalidate**: an expired entry is returned right away as
 *   `STALE` while one background refresh runs. If the refresh fails, the stale
 *   entry stays and the next read tries again. Stale entries leave only by LRU
 *   eviction, so the proxy can fall back to them when Docker Hub is failing.
 * - **Jittered TTL**: each stored entry lives `ttlMs × (1 ± jitter)`, so keys
 *   written together don't all expire together.
 *
 * This module only caches. It never calls Docker Hub and never sets HTTP
 * headers: callers pass the upstream call as `fetcher` and map `status` /
 * `ageMs` to `X-Cache` / `Age` themselves.
 */

/** Maps to the `X-Cache` header: `MISS` means the caller waited for a fetch. */
export type CacheStatus = 'HIT' | 'MISS' | 'STALE';

export interface CacheResult<T> {
  value: T;
  status: CacheStatus;
  /** True when the value is past its TTL (`status === 'STALE'`). */
  isStale: boolean;
  /** Milliseconds since the value was fetched. */
  ageMs: number;
}

export interface CacheGetOptions {
  /** Fresh lifetime in milliseconds, before jitter. `0` makes every read after the first stale. */
  ttlMs: number;
}

export interface CacheOptions {
  /** Upper bound on stored entries (`CACHE_MAX_ENTRIES`). At least 1. */
  maxEntries: number;
  /** Relative TTL jitter in [0, 1). Default 0.1, i.e. ±10%. */
  jitter?: number;
  /** Source of randomness in [0, 1), for tests. Default `Math.random`. */
  random?: () => number;
}

export const DEFAULT_TTL_JITTER = 0.1;

interface Entry {
  value: unknown;
  /** `Date.now()` when the value was fetched. */
  storedAt: number;
  /** `Date.now()` after which the value is stale. */
  expiresAt: number;
}

export class MemoryCache {
  private readonly maxEntries: number;
  private readonly jitter: number;
  private readonly random: () => number;
  /** Insertion order is recency order: the first key is the least recently used. */
  private readonly entries = new Map<string, Entry>();
  private readonly inflight = new Map<string, Promise<Entry>>();

  constructor(options: CacheOptions) {
    const { maxEntries, jitter = DEFAULT_TTL_JITTER, random = Math.random } = options;
    if (!Number.isInteger(maxEntries) || maxEntries < 1) {
      throw new RangeError(`maxEntries must be a whole number >= 1, got ${maxEntries}`);
    }
    if (!(jitter >= 0 && jitter < 1)) {
      throw new RangeError(`jitter must be in [0, 1), got ${jitter}`);
    }
    this.maxEntries = maxEntries;
    this.jitter = jitter;
    this.random = random;
  }

  /**
   * Returns the cached value for `key`, calling `fetcher` only when needed:
   * - fresh entry: `HIT`, no fetch;
   * - expired entry: `STALE` at once, plus one background refresh;
   * - no entry: `MISS`, after awaiting the (shared) fetch. A failed fetch
   *   rejects every waiting caller and isn't cached.
   *
   * Callers must keep one value type per key (e.g. prefix keys by resource).
   */
  async get<T>(
    key: string,
    options: CacheGetOptions,
    fetcher: () => Promise<T>,
  ): Promise<CacheResult<T>> {
    const { ttlMs } = options;
    if (!Number.isFinite(ttlMs) || ttlMs < 0) {
      throw new RangeError(`ttlMs must be a finite number >= 0, got ${ttlMs}`);
    }

    const entry = this.entries.get(key);
    if (entry) {
      this.touch(key, entry);
      const now = Date.now();
      const isStale = now >= entry.expiresAt;
      if (isStale) {
        // Background refresh: the caller doesn't wait, and a failure keeps the stale entry.
        this.load(key, ttlMs, fetcher).catch(() => {});
      }
      return {
        value: entry.value as T,
        status: isStale ? 'STALE' : 'HIT',
        isStale,
        ageMs: Math.max(0, now - entry.storedAt),
      };
    }

    const loaded = await this.load(key, ttlMs, fetcher);
    return {
      value: loaded.value as T,
      status: 'MISS',
      isStale: false,
      ageMs: Math.max(0, Date.now() - loaded.storedAt),
    };
  }

  /** True while a fetch (miss or background refresh) for `key` is running. */
  isFetching(key: string): boolean {
    return this.inflight.has(key);
  }

  /** Removes a stored entry. A fetch already in flight still stores its result. */
  delete(key: string): boolean {
    return this.entries.delete(key);
  }

  /** Removes every stored entry. Fetches already in flight still store their results. */
  clear(): void {
    this.entries.clear();
  }

  /** Number of stored entries (fresh or stale), at most `maxEntries`. */
  get size(): number {
    return this.entries.size;
  }

  /** Starts a fetch for `key`, or joins the one already in flight. */
  private load(key: string, ttlMs: number, fetcher: () => Promise<unknown>): Promise<Entry> {
    const existing = this.inflight.get(key);
    if (existing) return existing;

    const promise = (async () => {
      try {
        const value = await fetcher();
        const storedAt = Date.now();
        const entry: Entry = { value, storedAt, expiresAt: storedAt + this.jitteredTtl(ttlMs) };
        this.set(key, entry);
        return entry;
      } finally {
        this.inflight.delete(key);
      }
    })();
    this.inflight.set(key, promise);
    return promise;
  }

  private set(key: string, entry: Entry): void {
    this.entries.delete(key);
    this.entries.set(key, entry);
    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
    }
  }

  /** Marks `key` as most recently used. */
  private touch(key: string, entry: Entry): void {
    this.entries.delete(key);
    this.entries.set(key, entry);
  }

  /** `ttlMs` scaled by a random factor in [1 - jitter, 1 + jitter). */
  private jitteredTtl(ttlMs: number): number {
    return Math.round(ttlMs * (1 + this.jitter * (2 * this.random() - 1)));
  }
}

export function createCache(options: CacheOptions): MemoryCache {
  return new MemoryCache(options);
}

/** The proxy's shared cache, bounded by `CACHE_MAX_ENTRIES`. */
export const cache = createCache({ maxEntries: config.cache.maxEntries });
