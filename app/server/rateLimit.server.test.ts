/**
 * Unit tests for the per-client rate limiter, with an injected fake clock.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { config } from './config.server';
import {
  checkRateLimit,
  createRateLimiter,
  enforceRateLimit,
  ipToKey,
  rateLimitedResponse,
  resolveClientKey,
} from './rateLimit.server';

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

afterEach(() => {
  vi.restoreAllMocks();
});

describe('counting', () => {
  it('allows requests under the limit and counts down `remaining`', () => {
    const limiter = createRateLimiter({ windowMs: 60_000, max: 3, now: fakeClock().now });
    expect([1, 2, 3].map(() => limiter.hit('1.2.3.4'))).toStrictEqual(
      [2, 1, 0].map((remaining) => ({
        allowed: true,
        key: '1.2.3.4',
        limit: 3,
        remaining,
        retryAfterSeconds: 60,
      })),
    );
  });

  it('blocks the request after the limit, with Retry-After until the window resets', () => {
    const clock = fakeClock();
    const limiter = createRateLimiter({ windowMs: 60_000, max: 2, now: clock.now });
    limiter.hit('a');
    clock.advance(10_000);
    limiter.hit('a');
    clock.advance(15_500);
    const blocked = limiter.hit('a');
    expect(blocked.allowed).toBe(false);
    expect(blocked.remaining).toBe(0);
    // 60 s window started at t=0; now t=25.5 s, so 34.5 s left, rounded up.
    expect(blocked.retryAfterSeconds).toBe(35);
  });

  it('Retry-After is at least 1 second', () => {
    const clock = fakeClock();
    const limiter = createRateLimiter({ windowMs: 1_000, max: 1, now: clock.now });
    limiter.hit('a');
    clock.advance(999.9);
    expect(limiter.hit('a').retryAfterSeconds).toBe(1);
  });

  it('blocked requests do not extend the window', () => {
    const clock = fakeClock();
    const limiter = createRateLimiter({ windowMs: 60_000, max: 1, now: clock.now });
    limiter.hit('a');
    for (let i = 0; i < 10; i += 1) {
      clock.advance(5_000);
      expect(limiter.hit('a').allowed).toBe(false);
    }
    clock.advance(10_000); // t = 60 s
    expect(limiter.hit('a').allowed).toBe(true);
  });

  it('a new window starts after windowMs, with a fresh count', () => {
    const clock = fakeClock();
    const limiter = createRateLimiter({ windowMs: 60_000, max: 2, now: clock.now });
    limiter.hit('a');
    limiter.hit('a');
    expect(limiter.hit('a').allowed).toBe(false);
    clock.advance(59_999);
    expect(limiter.hit('a').allowed).toBe(false);
    clock.advance(1);
    const fresh = limiter.hit('a');
    expect(fresh.allowed).toBe(true);
    expect(fresh.remaining).toBe(1);
    expect(fresh.retryAfterSeconds).toBe(60);
  });

  it('fixed window: up to 2 × max in a burst across a window boundary (documented)', () => {
    const clock = fakeClock();
    const limiter = createRateLimiter({ windowMs: 60_000, max: 2, now: clock.now });
    limiter.hit('a'); // opens the 0-60 s window
    clock.advance(59_999);
    expect(limiter.hit('a').allowed).toBe(true);
    expect(limiter.hit('a').allowed).toBe(false);
    clock.advance(1); // new window
    expect(limiter.hit('a').allowed).toBe(true);
    expect(limiter.hit('a').allowed).toBe(true);
    expect(limiter.hit('a').allowed).toBe(false);
  });

  it('clients are counted separately', () => {
    const limiter = createRateLimiter({ windowMs: 60_000, max: 1, now: fakeClock().now });
    expect(limiter.hit('a').allowed).toBe(true);
    expect(limiter.hit('a').allowed).toBe(false);
    expect(limiter.hit('b').allowed).toBe(true);
  });
});

describe('memory', () => {
  it('expired windows are evicted on the next check', () => {
    const clock = fakeClock();
    const limiter = createRateLimiter({ windowMs: 60_000, max: 5, now: clock.now });
    for (let i = 0; i < 1_000; i += 1) limiter.hit(`10.0.${i >> 8}.${i & 0xff}`);
    expect(limiter.size()).toBe(1_000);
    clock.advance(30_000);
    limiter.hit('10.9.9.9');
    expect(limiter.size(), 'live windows are kept').toBe(1_001);
    clock.advance(30_000);
    limiter.hit('10.9.9.8');
    // The first 1,000 expired at t=60 s; 10.9.9.9 (until 90 s) and 10.9.9.8 remain.
    expect(limiter.size()).toBe(2);
  });

  it('an active client re-entering keeps its place in expiry order', () => {
    const clock = fakeClock();
    const limiter = createRateLimiter({ windowMs: 60_000, max: 5, now: clock.now });
    limiter.hit('a'); // window 0-60 s
    clock.advance(30_000);
    limiter.hit('b'); // window 30-90 s
    clock.advance(30_000);
    limiter.hit('a'); // a expired at 60 s: new window 60-120 s, re-inserted after b
    expect(limiter.size()).toBe(2);
    clock.advance(30_000); // t = 90 s: b expires, a doesn't
    limiter.hit('c');
    expect(limiter.size()).toBe(2);
    expect(limiter.hit('a').remaining, 'a kept its count').toBe(3);
  });

  it('maxKeys caps tracked clients by evicting the oldest', () => {
    const clock = fakeClock();
    const limiter = createRateLimiter({ windowMs: 60_000, max: 1, maxKeys: 3, now: clock.now });
    for (const key of ['a', 'b', 'c', 'd']) {
      limiter.hit(key);
      clock.advance(1);
    }
    expect(limiter.size()).toBe(3);
    expect(limiter.hit('a').allowed, 'a was evicted, so it starts over').toBe(true);
    expect(limiter.hit('d').allowed, 'd is still tracked').toBe(false);
    expect(limiter.size()).toBe(3);
  });
});

describe('client IP', () => {
  it.each<[string, string | null]>([
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
  ])('ipToKey(%j) is %j', (input, expected) => {
    expect(ipToKey(input)).toBe(expected);
  });

  it('X-Forwarded-For is ignored when no proxy is trusted', () => {
    const req = request({ 'X-Forwarded-For': '203.0.113.7' });
    expect(resolveClientKey(req, { trustProxyHops: 0 })).toBeNull();
    expect(
      resolveClientKey(req, { trustProxyHops: 0, clientAddress: '198.51.100.1' }),
      'the peer address wins over the header',
    ).toBe('198.51.100.1');
  });

  it('with trusted proxies, the client is the entry that many hops from the right', () => {
    // Client spoofs "1.1.1.1"; proxy A appends the real client, proxy B appends A.
    const req = request({ 'X-Forwarded-For': '1.1.1.1, 203.0.113.7, 10.0.0.2' });
    expect(resolveClientKey(req, { trustProxyHops: 1 })).toBe('10.0.0.2');
    expect(resolveClientKey(req, { trustProxyHops: 2 })).toBe('203.0.113.7');
    expect(resolveClientKey(req, { trustProxyHops: 3 })).toBe('1.1.1.1');
    expect(resolveClientKey(req, { trustProxyHops: 4 }), 'header shorter than hops').toBeNull();
  });

  it('with trusted proxies, a missing or bad header is unknown (no peer fallback)', () => {
    const opts = { trustProxyHops: 1, clientAddress: '10.0.0.1' };
    expect(resolveClientKey(request(), opts)).toBeNull();
    expect(resolveClientKey(request({ 'X-Forwarded-For': 'garbage' }), opts)).toBeNull();
    expect(resolveClientKey(request({ 'X-Forwarded-For': '1.2.3.4,' }), opts)).toBeNull();
  });

  it('multiple X-Forwarded-For headers are read as one list', () => {
    const headers = new Headers();
    headers.append('X-Forwarded-For', '1.1.1.1');
    headers.append('X-Forwarded-For', '203.0.113.7');
    const req = new Request('http://localhost/', { headers });
    expect(resolveClientKey(req, { trustProxyHops: 1 })).toBe('203.0.113.7');
  });

  it('IPv6 clients in the same /64 share a bucket', () => {
    const limiter = createRateLimiter({ windowMs: 60_000, max: 1, now: fakeClock().now });
    const opts = { limiter, trustProxyHops: 1 };
    expect(checkRateLimit(request({ 'X-Forwarded-For': '2001:db8::1' }), opts).allowed).toBe(true);
    expect(checkRateLimit(request({ 'X-Forwarded-For': '2001:db8::2' }), opts).allowed).toBe(false);
    expect(checkRateLimit(request({ 'X-Forwarded-For': '2001:db9::1' }), opts).allowed).toBe(true);
  });
});

describe('request helpers', () => {
  it('checkRateLimit does not limit unidentified clients', () => {
    const limiter = createRateLimiter({ windowMs: 60_000, max: 1, now: fakeClock().now });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    for (let i = 0; i < 5; i += 1) {
      const result = checkRateLimit(request(), { limiter, trustProxyHops: 0 });
      expect(result.allowed).toBe(true);
      expect(result.key).toBeNull();
    }
    expect(limiter.size()).toBe(0);
    expect(warn, 'warns once').toHaveBeenCalledTimes(1);
  });

  it('rateLimitedResponse is a 429 JSON error with Retry-After and no-store', async () => {
    const response = rateLimitedResponse({ retryAfterSeconds: 42 });
    expect(response.status).toBe(429);
    expect(response.headers.get('Retry-After')).toBe('42');
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(response.headers.get('Content-Type')).toMatch(/^application\/json/);
    expect(await response.json()).toStrictEqual({
      error: { code: 'rate_limited', message: 'Too many requests. Try again later.' },
      retryAfterSeconds: 42,
    });
  });

  it('rateLimitedResponse rounds the wait up to at least 1 s, in the header and the body', async () => {
    const response = rateLimitedResponse({ retryAfterSeconds: 0 });
    expect(response.headers.get('Retry-After')).toBe('1');
    expect(await response.json()).toMatchObject({ retryAfterSeconds: 1 });
  });

  it('enforceRateLimit returns the result, then throws the 429 Response', () => {
    const limiter = createRateLimiter({ windowMs: 60_000, max: 1, now: fakeClock().now });
    const opts = { limiter, clientAddress: '198.51.100.1', trustProxyHops: 0 };
    expect(enforceRateLimit(request(), opts).remaining).toBe(0);
    let thrown: unknown;
    try {
      enforceRateLimit(request(), opts);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(Response);
    const response = thrown as Response;
    expect(response.status).toBe(429);
    expect(response.headers.get('Retry-After')).toBe('60');
  });

  it('the default limiter reads RATE_LIMIT_MAX from config', () => {
    // Read the limit from config, so an exported RATE_LIMIT_MAX doesn't break the test.
    // A documentation-range address no other test uses.
    const { max } = config.rateLimit;
    const opts = { clientAddress: '192.0.2.250', trustProxyHops: 0 };
    for (let i = 0; i < max; i += 1) expect(checkRateLimit(request(), opts).allowed).toBe(true);
    const blocked = checkRateLimit(request(), opts);
    expect(blocked.allowed).toBe(false);
    expect(blocked.limit).toBe(max);
  });
});
