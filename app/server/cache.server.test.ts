/**
 * Unit tests for the in-memory cache, with a fake `Date` (only `Date` is faked,
 * so `setImmediate` in `flush` still runs for real).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cache, createCache, MemoryCache } from './cache.server';

/** A promise plus the functions that settle it, so a test controls when a fetch ends. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** Lets pending promise callbacks (e.g. a background refresh) run. */
const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

/** A fetcher that counts its calls and resolves with `value`. */
const counter = <T>(value: T) => vi.fn(() => Promise.resolve(value));

const fakeDate = () => vi.useFakeTimers({ toFake: ['Date'], now: 0 });

const TTL = { ttlMs: 1000 };

beforeEach(() => {
  fakeDate();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('MemoryCache basics', () => {
  it('fetches on a miss, then serves hits with a growing age', async () => {
    const c = createCache({ maxEntries: 10, jitter: 0 });
    const fetcher = counter('v1');

    const first = await c.get('k', TTL, fetcher);
    expect(first).toStrictEqual({ value: 'v1', status: 'MISS', isStale: false, ageMs: 0 });

    vi.advanceTimersByTime(400);
    const second = await c.get('k', TTL, fetcher);
    expect(second).toStrictEqual({ value: 'v1', status: 'HIT', isStale: false, ageMs: 400 });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('rejects invalid options', async () => {
    expect(() => createCache({ maxEntries: 0 })).toThrow(RangeError);
    expect(() => createCache({ maxEntries: 1.5 })).toThrow(RangeError);
    expect(() => createCache({ maxEntries: 1, jitter: 1 })).toThrow(RangeError);
    expect(() => createCache({ maxEntries: 1, jitter: -0.1 })).toThrow(RangeError);
    const c = createCache({ maxEntries: 1 });
    await expect(c.get('k', { ttlMs: -1 }, counter(1))).rejects.toThrow(RangeError);
    await expect(c.get('k', { ttlMs: Number.NaN }, counter(1))).rejects.toThrow(RangeError);
  });

  it('exports a shared instance', () => {
    expect(cache).toBeInstanceOf(MemoryCache);
  });
});

describe('LRU eviction', () => {
  it('never holds more than maxEntries and evicts the least recently used key', async () => {
    const c = createCache({ maxEntries: 2, jitter: 0 });
    const a = counter('a');
    const b = counter('b');
    const d = counter('d');

    await c.get('a', TTL, a);
    await c.get('b', TTL, b);
    await c.get('a', TTL, a); // `a` is now more recent than `b`.
    await c.get('d', TTL, d); // Over the bound: evicts `b`.

    expect(c.size).toBe(2);
    expect((await c.get('a', TTL, a)).status).toBe('HIT');
    expect((await c.get('d', TTL, d)).status).toBe('HIT');
    expect(a).toHaveBeenCalledTimes(1);

    const again = await c.get('b', TTL, b);
    expect(again.status).toBe('MISS');
    expect(b).toHaveBeenCalledTimes(2);
    expect(c.size).toBe(2);
  });

  it('counts stale entries against the bound too', async () => {
    const c = createCache({ maxEntries: 1, jitter: 0 });
    await c.get('a', TTL, counter('a'));
    vi.advanceTimersByTime(5000);
    await c.get('b', TTL, counter('b'));
    expect(c.size).toBe(1);
    expect((await c.get('b', TTL, counter('x'))).value).toBe('b');
  });
});

describe('single-flight', () => {
  it('shares one fetch between concurrent misses for a key', async () => {
    const c = createCache({ maxEntries: 10, jitter: 0 });
    const pending = deferred<string>();
    const fetcher = vi.fn(() => pending.promise);

    const calls = Array.from({ length: 5 }, () => c.get('k', TTL, fetcher));
    expect(c.isFetching('k')).toBe(true);
    pending.resolve('v');
    const results = await Promise.all(calls);

    expect(fetcher).toHaveBeenCalledTimes(1);
    for (const result of results) {
      expect(result.value).toBe('v');
      expect(result.status).toBe('MISS');
    }
    expect(c.isFetching('k')).toBe(false);
  });

  it('fetches different keys independently', async () => {
    const c = createCache({ maxEntries: 10, jitter: 0 });
    const fetcher = counter('v');
    await Promise.all([c.get('a', TTL, fetcher), c.get('b', TTL, fetcher)]);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('rejects every waiter on failure, caches nothing, and retries on the next call', async () => {
    const c = createCache({ maxEntries: 10, jitter: 0 });
    const pending = deferred<string>();
    const failing = vi.fn(() => pending.promise);

    const calls = [c.get('k', TTL, failing), c.get('k', TTL, failing)];
    pending.reject(new Error('upstream down'));
    for (const call of calls) await expect(call).rejects.toThrow(/upstream down/);

    expect(failing).toHaveBeenCalledTimes(1);
    expect(c.size).toBe(0);
    expect(c.isFetching('k')).toBe(false);

    const ok = counter('v');
    expect((await c.get('k', TTL, ok)).status).toBe('MISS');
    expect(ok).toHaveBeenCalledTimes(1);
  });

  it('frees the slot when the fetcher throws synchronously', async () => {
    const c = createCache({ maxEntries: 10, jitter: 0 });
    const throwing = vi.fn((): Promise<string> => {
      throw new Error('bad request');
    });

    await expect(c.get('k', TTL, throwing)).rejects.toThrow(/bad request/);
    expect(c.isFetching('k')).toBe(false);
    expect((await c.get('k', TTL, counter('v'))).value).toBe('v');

    // Same on a background refresh: the stale entry stays and the next read retries.
    vi.advanceTimersByTime(1000);
    expect((await c.get('k', TTL, throwing)).status).toBe('STALE');
    await flush();
    expect(c.isFetching('k')).toBe(false);
    const retry = counter('new');
    await c.get('k', TTL, retry);
    await flush();
    expect(retry).toHaveBeenCalledTimes(1);
    expect((await c.get('k', TTL, retry)).value).toBe('new');
  });
});

describe('stale-while-revalidate', () => {
  it('serves the stale value at once and runs exactly one background refresh', async () => {
    const c = createCache({ maxEntries: 10, jitter: 0 });
    await c.get('k', TTL, counter('old'));

    vi.advanceTimersByTime(1000);
    const refresh = deferred<string>();
    const refresher = vi.fn(() => refresh.promise);

    // Several readers while the refresh is pending: none waits, one fetch total.
    for (let i = 0; i < 3; i += 1) {
      const result = await c.get('k', TTL, refresher);
      expect(result).toStrictEqual({ value: 'old', status: 'STALE', isStale: true, ageMs: 1000 });
    }
    expect(refresher).toHaveBeenCalledTimes(1);
    expect(c.isFetching('k')).toBe(true);

    refresh.resolve('new');
    await flush();
    expect(c.isFetching('k')).toBe(false);

    const fresh = await c.get('k', TTL, refresher);
    expect(fresh).toStrictEqual({ value: 'new', status: 'HIT', isStale: false, ageMs: 0 });
    expect(refresher).toHaveBeenCalledTimes(1);
  });

  it('keeps the stale entry when the refresh fails and retries on the next read', async () => {
    const c = createCache({ maxEntries: 10, jitter: 0 });
    await c.get('k', TTL, counter('old'));
    vi.advanceTimersByTime(2000);

    const failing = vi.fn(() => Promise.reject(new Error('429')));
    const stale = await c.get('k', TTL, failing);
    expect(stale.status).toBe('STALE');
    await flush();
    expect(failing).toHaveBeenCalledTimes(1);
    expect(c.isFetching('k')).toBe(false);

    const stillStale = await c.get('k', TTL, failing);
    expect(stillStale.value).toBe('old');
    expect(stillStale.status).toBe('STALE');
    await flush();
    expect(failing).toHaveBeenCalledTimes(2);
  });

  it('lets a miss join a refresh that is already in flight', async () => {
    const c = createCache({ maxEntries: 10, jitter: 0 });
    await c.get('k', TTL, counter('old'));
    vi.advanceTimersByTime(1000);

    const refresh = deferred<string>();
    const refresher = vi.fn(() => refresh.promise);
    await c.get('k', TTL, refresher); // STALE, starts the refresh.
    c.delete('k');

    const miss = c.get('k', TTL, refresher);
    refresh.resolve('new');
    expect((await miss).value).toBe('new');
    expect(refresher).toHaveBeenCalledTimes(1);
  });

  it('treats ttlMs 0 as stale on every read after the first', async () => {
    const c = createCache({ maxEntries: 10, jitter: 0 });
    const fetcher = counter('v');
    expect((await c.get('k', { ttlMs: 0 }, fetcher)).status).toBe('MISS');
    expect((await c.get('k', { ttlMs: 0 }, fetcher)).status).toBe('STALE');
    await flush();
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});

describe('TTL jitter', () => {
  /** Ms after the write at which the entry first reads as stale. */
  async function expiryWith(random: number): Promise<number> {
    vi.useRealTimers();
    fakeDate();
    const c = createCache({ maxEntries: 10, jitter: 0.1, random: () => random });
    await c.get('k', TTL, counter('v'));
    let elapsed = 0;
    while ((await c.get('k', TTL, () => new Promise<string>(() => {}))).status === 'HIT') {
      vi.advanceTimersByTime(10);
      elapsed += 10;
    }
    return elapsed;
  }

  it('scales the TTL by 1 ± jitter', async () => {
    expect(await expiryWith(0)).toBe(900);
    expect(await expiryWith(0.5)).toBe(1000);
    expect(await expiryWith(0.75)).toBe(1050);
    expect(await expiryWith(0.999)).toBe(1100);
  });

  it('spreads expiries of entries written together (default jitter, Math.random)', async () => {
    const c = createCache({ maxEntries: 100 });
    const keys = Array.from({ length: 50 }, (_, i) => `k${i}`);
    for (const key of keys) await c.get(key, TTL, counter(key));
    const pending = () => new Promise<string>(() => {});
    const statuses = async () =>
      Promise.all(keys.map(async (key) => (await c.get(key, TTL, pending)).status));

    vi.advanceTimersByTime(899);
    expect((await statuses()).every((status) => status === 'HIT')).toBe(true);

    vi.advanceTimersByTime(101); // t = 1000: roughly half have expired.
    const middle = await statuses();
    expect(middle).toContain('HIT');
    expect(middle).toContain('STALE');

    vi.advanceTimersByTime(100); // t = 1100: past the upper bound.
    expect((await statuses()).every((status) => status === 'STALE')).toBe(true);
  });
});
