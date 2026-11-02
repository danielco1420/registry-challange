/**
 * Unit tests for the in-memory cache, on Node's built-in test runner with fake
 * `Date` (`mock.timers`). Vitest isn't set up yet (#5); port these when it is.
 */
import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it, mock } from 'node:test';
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
function counter<T>(value: T) {
  const fn = mock.fn(() => Promise.resolve(value));
  return fn;
}

const TTL = { ttlMs: 1000 };

beforeEach(() => {
  mock.timers.enable({ apis: ['Date'], now: 0 });
});

afterEach(() => {
  mock.timers.reset();
  mock.restoreAll();
});

describe('MemoryCache basics', () => {
  it('fetches on a miss, then serves hits with a growing age', async () => {
    const c = createCache({ maxEntries: 10, jitter: 0 });
    const fetcher = counter('v1');

    const first = await c.get('k', TTL, fetcher);
    assert.deepEqual(first, { value: 'v1', status: 'MISS', isStale: false, ageMs: 0 });

    mock.timers.tick(400);
    const second = await c.get('k', TTL, fetcher);
    assert.deepEqual(second, { value: 'v1', status: 'HIT', isStale: false, ageMs: 400 });
    assert.equal(fetcher.mock.callCount(), 1);
  });

  it('rejects invalid options', async () => {
    assert.throws(() => createCache({ maxEntries: 0 }), RangeError);
    assert.throws(() => createCache({ maxEntries: 1.5 }), RangeError);
    assert.throws(() => createCache({ maxEntries: 1, jitter: 1 }), RangeError);
    assert.throws(() => createCache({ maxEntries: 1, jitter: -0.1 }), RangeError);
    const c = createCache({ maxEntries: 1 });
    await assert.rejects(c.get('k', { ttlMs: -1 }, counter(1)), RangeError);
    await assert.rejects(c.get('k', { ttlMs: Number.NaN }, counter(1)), RangeError);
  });

  it('exports a shared instance', () => {
    assert.ok(cache instanceof MemoryCache);
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

    assert.equal(c.size, 2);
    assert.equal((await c.get('a', TTL, a)).status, 'HIT');
    assert.equal((await c.get('d', TTL, d)).status, 'HIT');
    assert.equal(a.mock.callCount(), 1);

    const again = await c.get('b', TTL, b);
    assert.equal(again.status, 'MISS');
    assert.equal(b.mock.callCount(), 2);
    assert.equal(c.size, 2);
  });

  it('counts stale entries against the bound too', async () => {
    const c = createCache({ maxEntries: 1, jitter: 0 });
    await c.get('a', TTL, counter('a'));
    mock.timers.tick(5000);
    await c.get('b', TTL, counter('b'));
    assert.equal(c.size, 1);
    assert.equal((await c.get('b', TTL, counter('x'))).value, 'b');
  });
});

describe('single-flight', () => {
  it('shares one fetch between concurrent misses for a key', async () => {
    const c = createCache({ maxEntries: 10, jitter: 0 });
    const pending = deferred<string>();
    const fetcher = mock.fn(() => pending.promise);

    const calls = Array.from({ length: 5 }, () => c.get('k', TTL, fetcher));
    assert.equal(c.isFetching('k'), true);
    pending.resolve('v');
    const results = await Promise.all(calls);

    assert.equal(fetcher.mock.callCount(), 1);
    for (const result of results) {
      assert.equal(result.value, 'v');
      assert.equal(result.status, 'MISS');
    }
    assert.equal(c.isFetching('k'), false);
  });

  it('fetches different keys independently', async () => {
    const c = createCache({ maxEntries: 10, jitter: 0 });
    const fetcher = counter('v');
    await Promise.all([c.get('a', TTL, fetcher), c.get('b', TTL, fetcher)]);
    assert.equal(fetcher.mock.callCount(), 2);
  });

  it('rejects every waiter on failure, caches nothing, and retries on the next call', async () => {
    const c = createCache({ maxEntries: 10, jitter: 0 });
    const pending = deferred<string>();
    const failing = mock.fn(() => pending.promise);

    const calls = [c.get('k', TTL, failing), c.get('k', TTL, failing)];
    pending.reject(new Error('upstream down'));
    for (const call of calls) await assert.rejects(call, /upstream down/);

    assert.equal(failing.mock.callCount(), 1);
    assert.equal(c.size, 0);
    assert.equal(c.isFetching('k'), false);

    const ok = counter('v');
    assert.equal((await c.get('k', TTL, ok)).status, 'MISS');
    assert.equal(ok.mock.callCount(), 1);
  });
});

describe('stale-while-revalidate', () => {
  it('serves the stale value at once and runs exactly one background refresh', async () => {
    const c = createCache({ maxEntries: 10, jitter: 0 });
    await c.get('k', TTL, counter('old'));

    mock.timers.tick(1000);
    const refresh = deferred<string>();
    const refresher = mock.fn(() => refresh.promise);

    // Several readers while the refresh is pending: none waits, one fetch total.
    for (let i = 0; i < 3; i += 1) {
      const result = await c.get('k', TTL, refresher);
      assert.deepEqual(result, { value: 'old', status: 'STALE', isStale: true, ageMs: 1000 });
    }
    assert.equal(refresher.mock.callCount(), 1);
    assert.equal(c.isFetching('k'), true);

    refresh.resolve('new');
    await flush();
    assert.equal(c.isFetching('k'), false);

    const fresh = await c.get('k', TTL, refresher);
    assert.deepEqual(fresh, { value: 'new', status: 'HIT', isStale: false, ageMs: 0 });
    assert.equal(refresher.mock.callCount(), 1);
  });

  it('keeps the stale entry when the refresh fails and retries on the next read', async () => {
    const c = createCache({ maxEntries: 10, jitter: 0 });
    await c.get('k', TTL, counter('old'));
    mock.timers.tick(2000);

    const failing = mock.fn(() => Promise.reject(new Error('429')));
    const stale = await c.get('k', TTL, failing);
    assert.equal(stale.status, 'STALE');
    await flush();
    assert.equal(failing.mock.callCount(), 1);
    assert.equal(c.isFetching('k'), false);

    const stillStale = await c.get('k', TTL, failing);
    assert.equal(stillStale.value, 'old');
    assert.equal(stillStale.status, 'STALE');
    await flush();
    assert.equal(failing.mock.callCount(), 2);
  });

  it('lets a miss join a refresh that is already in flight', async () => {
    const c = createCache({ maxEntries: 10, jitter: 0 });
    await c.get('k', TTL, counter('old'));
    mock.timers.tick(1000);

    const refresh = deferred<string>();
    const refresher = mock.fn(() => refresh.promise);
    await c.get('k', TTL, refresher); // STALE, starts the refresh.
    c.delete('k');

    const miss = c.get('k', TTL, refresher);
    refresh.resolve('new');
    assert.equal((await miss).value, 'new');
    assert.equal(refresher.mock.callCount(), 1);
  });

  it('treats ttlMs 0 as stale on every read after the first', async () => {
    const c = createCache({ maxEntries: 10, jitter: 0 });
    const fetcher = counter('v');
    assert.equal((await c.get('k', { ttlMs: 0 }, fetcher)).status, 'MISS');
    assert.equal((await c.get('k', { ttlMs: 0 }, fetcher)).status, 'STALE');
    await flush();
    assert.equal(fetcher.mock.callCount(), 2);
  });
});

describe('TTL jitter', () => {
  /** Ms after the write at which the entry first reads as stale. */
  async function expiryWith(random: number): Promise<number> {
    mock.timers.reset();
    mock.timers.enable({ apis: ['Date'], now: 0 });
    const c = createCache({ maxEntries: 10, jitter: 0.1, random: () => random });
    await c.get('k', TTL, counter('v'));
    let elapsed = 0;
    while ((await c.get('k', TTL, () => new Promise<string>(() => {}))).status === 'HIT') {
      mock.timers.tick(10);
      elapsed += 10;
    }
    return elapsed;
  }

  it('scales the TTL by 1 ± jitter', async () => {
    assert.equal(await expiryWith(0), 900);
    assert.equal(await expiryWith(0.5), 1000);
    assert.equal(await expiryWith(0.75), 1050);
    assert.equal(await expiryWith(0.999), 1100);
  });

  it('spreads expiries of entries written together (default jitter, Math.random)', async () => {
    const c = createCache({ maxEntries: 100 });
    const keys = Array.from({ length: 50 }, (_, i) => `k${i}`);
    for (const key of keys) await c.get(key, TTL, counter(key));
    const pending = () => new Promise<string>(() => {});
    const statuses = async () =>
      Promise.all(keys.map(async (key) => (await c.get(key, TTL, pending)).status));

    mock.timers.tick(899);
    assert.ok((await statuses()).every((status) => status === 'HIT'));

    mock.timers.tick(101); // t = 1000: roughly half have expired.
    const middle = await statuses();
    assert.ok(middle.includes('HIT') && middle.includes('STALE'));

    mock.timers.tick(100); // t = 1100: past the upper bound.
    assert.ok((await statuses()).every((status) => status === 'STALE'));
  });
});
