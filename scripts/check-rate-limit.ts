/**
 * Unit checks for `app/server/rateLimit.server.ts`. Vitest isn't set up yet
 * (#5), so like `check-params.ts` this is a dependency-free stand-in run by
 * `pnpm test`, using `node:assert` and a fake clock.
 */
import assert from 'node:assert/strict';

import { config } from '../app/server/config.server';
import {
  checkRateLimit,
  createRateLimiter,
  enforceRateLimit,
  ipToKey,
  rateLimitedResponse,
  resolveClientKey,
} from '../app/server/rateLimit.server';

const cases: Array<{ name: string; run: () => void | Promise<void> }> = [];
const test = (name: string, run: () => void | Promise<void>) => cases.push({ name, run });

function fakeClock(start = 1_000) {
  let time = start;
  return {
    now: () => time,
    advance: (ms: number) => {
      time += ms;
    },
  };
}

const request = (headers: Record<string, string> = {}) =>
  new Request('http://localhost/api/search?q=nginx', { headers });

// --- Counting ---------------------------------------------------------------

test('allows requests under the limit and counts down `remaining`', () => {
  const limiter = createRateLimiter({ windowMs: 60_000, max: 3, now: fakeClock().now });
  assert.deepEqual(
    [1, 2, 3].map(() => limiter.hit('1.2.3.4')),
    [2, 1, 0].map((remaining) => ({
      allowed: true,
      key: '1.2.3.4',
      limit: 3,
      remaining,
      retryAfterSeconds: 60,
    })),
  );
});

test('blocks the request after the limit, with Retry-After until the window resets', () => {
  const clock = fakeClock();
  const limiter = createRateLimiter({ windowMs: 60_000, max: 2, now: clock.now });
  limiter.hit('a');
  clock.advance(10_000);
  limiter.hit('a');
  clock.advance(15_500);
  const blocked = limiter.hit('a');
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.remaining, 0);
  // 60 s window started at t=0; now t=25.5 s, so 34.5 s left, rounded up.
  assert.equal(blocked.retryAfterSeconds, 35);
});

test('Retry-After is at least 1 second', () => {
  const clock = fakeClock();
  const limiter = createRateLimiter({ windowMs: 1_000, max: 1, now: clock.now });
  limiter.hit('a');
  clock.advance(999.9);
  assert.equal(limiter.hit('a').retryAfterSeconds, 1);
});

test('blocked requests do not extend the window', () => {
  const clock = fakeClock();
  const limiter = createRateLimiter({ windowMs: 60_000, max: 1, now: clock.now });
  limiter.hit('a');
  for (let i = 0; i < 10; i += 1) {
    clock.advance(5_000);
    assert.equal(limiter.hit('a').allowed, false);
  }
  clock.advance(10_000); // t = 60 s
  assert.equal(limiter.hit('a').allowed, true);
});

test('a new window starts after windowMs, with a fresh count', () => {
  const clock = fakeClock();
  const limiter = createRateLimiter({ windowMs: 60_000, max: 2, now: clock.now });
  limiter.hit('a');
  limiter.hit('a');
  assert.equal(limiter.hit('a').allowed, false);
  clock.advance(59_999);
  assert.equal(limiter.hit('a').allowed, false);
  clock.advance(1);
  const fresh = limiter.hit('a');
  assert.equal(fresh.allowed, true);
  assert.equal(fresh.remaining, 1);
  assert.equal(fresh.retryAfterSeconds, 60);
});

test('fixed window: up to 2 × max in a burst across a window boundary (documented)', () => {
  const clock = fakeClock();
  const limiter = createRateLimiter({ windowMs: 60_000, max: 2, now: clock.now });
  limiter.hit('a'); // opens the 0-60 s window
  clock.advance(59_999);
  assert.equal(limiter.hit('a').allowed, true);
  assert.equal(limiter.hit('a').allowed, false);
  clock.advance(1); // new window
  assert.equal(limiter.hit('a').allowed, true);
  assert.equal(limiter.hit('a').allowed, true);
  assert.equal(limiter.hit('a').allowed, false);
});

test('clients are counted separately', () => {
  const limiter = createRateLimiter({ windowMs: 60_000, max: 1, now: fakeClock().now });
  assert.equal(limiter.hit('a').allowed, true);
  assert.equal(limiter.hit('a').allowed, false);
  assert.equal(limiter.hit('b').allowed, true);
});

// --- Memory -----------------------------------------------------------------

test('expired windows are evicted on the next check', () => {
  const clock = fakeClock();
  const limiter = createRateLimiter({ windowMs: 60_000, max: 5, now: clock.now });
  for (let i = 0; i < 1_000; i += 1) limiter.hit(`10.0.${i >> 8}.${i & 0xff}`);
  assert.equal(limiter.size(), 1_000);
  clock.advance(30_000);
  limiter.hit('10.9.9.9');
  assert.equal(limiter.size(), 1_001, 'live windows are kept');
  clock.advance(30_000);
  limiter.hit('10.9.9.8');
  // The first 1,000 expired at t=60 s; 10.9.9.9 (until 90 s) and 10.9.9.8 remain.
  assert.equal(limiter.size(), 2);
});

test('an active client re-entering keeps its place in expiry order', () => {
  const clock = fakeClock();
  const limiter = createRateLimiter({ windowMs: 60_000, max: 5, now: clock.now });
  limiter.hit('a'); // window 0-60 s
  clock.advance(30_000);
  limiter.hit('b'); // window 30-90 s
  clock.advance(30_000);
  limiter.hit('a'); // a expired at 60 s: new window 60-120 s, re-inserted after b
  assert.equal(limiter.size(), 2);
  clock.advance(30_000); // t = 90 s: b expires, a doesn't
  limiter.hit('c');
  assert.equal(limiter.size(), 2);
  assert.equal(limiter.hit('a').remaining, 3, 'a kept its count');
});

test('maxKeys caps tracked clients by evicting the oldest', () => {
  const clock = fakeClock();
  const limiter = createRateLimiter({ windowMs: 60_000, max: 1, maxKeys: 3, now: clock.now });
  for (const key of ['a', 'b', 'c', 'd']) {
    limiter.hit(key);
    clock.advance(1);
  }
  assert.equal(limiter.size(), 3);
  assert.equal(limiter.hit('a').allowed, true, 'a was evicted, so it starts over');
  assert.equal(limiter.hit('d').allowed, false, 'd is still tracked');
  assert.equal(limiter.size(), 3);
});

// --- Client IP --------------------------------------------------------------

test('ipToKey normalizes addresses', () => {
  const table: Array<[string, string | null]> = [
    ['203.0.113.7', '203.0.113.7'],
    [' 203.0.113.7 ', '203.0.113.7'],
    ['203.0.113.7:51234', '203.0.113.7'],
    ['::ffff:203.0.113.7', '203.0.113.7'],
    ['[::ffff:cb00:7107]:443', '203.0.113.7'],
    ['2001:db8:1:2:3:4:5:6', '2001:db8:1:2::/64'],
    ['2001:DB8:1:2::9', '2001:db8:1:2::/64'],
    ['[2001:db8:1:2::9]:8080', '2001:db8:1:2::/64'],
    ['2001:db8::1', '2001:db8:0:0::/64'],
    ['::1', '0:0:0:0::/64'],
    ['fe80::1%eth0', 'fe80:0:0:0::/64'],
    ['64:ff9b::192.0.2.1', '192.0.2.1'],
    ['64:ff9b::c000:202', '192.0.2.2'],
    ['64:ff9b:1::192.0.2.1', '64:ff9b:1:0::/64'],
    ['1.2.3.4%eth0', null],
    ['', null],
    ['unknown', null],
    ['999.1.1.1', null],
    ['1.2.3', null],
    ['example.com', null],
    ['http://1.2.3.4/', null],
  ];
  for (const [input, expected] of table) {
    assert.equal(ipToKey(input), expected, `ipToKey(${JSON.stringify(input)})`);
  }
});

test('X-Forwarded-For is ignored when no proxy is trusted', () => {
  const req = request({ 'X-Forwarded-For': '203.0.113.7' });
  assert.equal(resolveClientKey(req, { trustProxyHops: 0 }), null);
  assert.equal(
    resolveClientKey(req, { trustProxyHops: 0, clientAddress: '198.51.100.1' }),
    '198.51.100.1',
    'the peer address wins over the header',
  );
});

test('with trusted proxies, the client is the entry that many hops from the right', () => {
  // Client spoofs "1.1.1.1"; proxy A appends the real client, proxy B appends A.
  const req = request({ 'X-Forwarded-For': '1.1.1.1, 203.0.113.7, 10.0.0.2' });
  assert.equal(resolveClientKey(req, { trustProxyHops: 1 }), '10.0.0.2');
  assert.equal(resolveClientKey(req, { trustProxyHops: 2 }), '203.0.113.7');
  assert.equal(resolveClientKey(req, { trustProxyHops: 3 }), '1.1.1.1');
  assert.equal(resolveClientKey(req, { trustProxyHops: 4 }), null, 'header shorter than hops');
});

test('with trusted proxies, a missing or bad header is unknown (no peer fallback)', () => {
  const opts = { trustProxyHops: 1, clientAddress: '10.0.0.1' };
  assert.equal(resolveClientKey(request(), opts), null);
  assert.equal(resolveClientKey(request({ 'X-Forwarded-For': 'garbage' }), opts), null);
  assert.equal(resolveClientKey(request({ 'X-Forwarded-For': '1.2.3.4,' }), opts), null);
});

test('multiple X-Forwarded-For headers are read as one list', () => {
  const headers = new Headers();
  headers.append('X-Forwarded-For', '1.1.1.1');
  headers.append('X-Forwarded-For', '203.0.113.7');
  const req = new Request('http://localhost/', { headers });
  assert.equal(resolveClientKey(req, { trustProxyHops: 1 }), '203.0.113.7');
});

test('IPv6 clients in the same /64 share a bucket', () => {
  const limiter = createRateLimiter({ windowMs: 60_000, max: 1, now: fakeClock().now });
  const opts = { limiter, trustProxyHops: 1 };
  assert.equal(checkRateLimit(request({ 'X-Forwarded-For': '2001:db8::1' }), opts).allowed, true);
  assert.equal(checkRateLimit(request({ 'X-Forwarded-For': '2001:db8::2' }), opts).allowed, false);
  assert.equal(checkRateLimit(request({ 'X-Forwarded-For': '2001:db9::1' }), opts).allowed, true);
});

// --- Request helpers --------------------------------------------------------

test('checkRateLimit does not limit unidentified clients', () => {
  const limiter = createRateLimiter({ windowMs: 60_000, max: 1, now: fakeClock().now });
  const originalWarn = console.warn;
  const warnings: unknown[] = [];
  console.warn = (...args: unknown[]) => warnings.push(args);
  try {
    for (let i = 0; i < 5; i += 1) {
      const result = checkRateLimit(request(), { limiter, trustProxyHops: 0 });
      assert.equal(result.allowed, true);
      assert.equal(result.key, null);
    }
  } finally {
    console.warn = originalWarn;
  }
  assert.equal(limiter.size(), 0);
  assert.equal(warnings.length, 1, 'warns once');
});

test('rateLimitedResponse is a 429 JSON error with Retry-After and no-store', async () => {
  const response = rateLimitedResponse({ retryAfterSeconds: 42 });
  assert.equal(response.status, 429);
  assert.equal(response.headers.get('Retry-After'), '42');
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  assert.match(response.headers.get('Content-Type') ?? '', /^application\/json/);
  assert.deepEqual(await response.json(), {
    error: { code: 'rate_limited', message: 'Too many requests. Try again later.' },
  });
});

test('enforceRateLimit returns the result, then throws the 429 Response', async () => {
  const limiter = createRateLimiter({ windowMs: 60_000, max: 1, now: fakeClock().now });
  const opts = { limiter, clientAddress: '198.51.100.1', trustProxyHops: 0 };
  assert.equal(enforceRateLimit(request(), opts).remaining, 0);
  let thrown: unknown;
  try {
    enforceRateLimit(request(), opts);
  } catch (error) {
    thrown = error;
  }
  assert.ok(thrown instanceof Response, 'throws a Response');
  assert.equal(thrown.status, 429);
  assert.equal(thrown.headers.get('Retry-After'), '60');
});

test('the default limiter reads RATE_LIMIT_MAX from config', () => {
  // Read the limit from config, so an exported RATE_LIMIT_MAX doesn't break the test.
  // A documentation-range address no other test uses.
  const { max } = config.rateLimit;
  const opts = { clientAddress: '192.0.2.250', trustProxyHops: 0 };
  for (let i = 0; i < max; i += 1) assert.equal(checkRateLimit(request(), opts).allowed, true);
  const blocked = checkRateLimit(request(), opts);
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.limit, max);
});

let failures = 0;
for (const { name, run } of cases) {
  try {
    await run();
  } catch (error) {
    failures += 1;
    console.error(`FAIL rate limit: ${name}\n  ${String(error).replaceAll('\n', '\n  ')}`);
  }
}

if (failures > 0) {
  console.error(`\n${failures}/${cases.length} rate-limit cases failed.`);
  process.exit(1);
}
console.log(`${cases.length}/${cases.length} rate-limit cases passed.`);
