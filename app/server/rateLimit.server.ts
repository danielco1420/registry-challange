/**
 * Per-client rate limit for our proxy (`/api/*`) and SSR page loaders
 * (ADR-0003, questionnaire G42, RISKS 2.1).
 *
 * Each client gets `RATE_LIMIT_MAX` requests per fixed window of
 * `RATE_LIMIT_WINDOW_MS`. Over the limit, callers answer 429 with `Retry-After`
 * (seconds until the client's window resets). State is in memory, per process,
 * like the cache (ADR-0003): it's lost on restart and not shared across instances.
 *
 * Usage from a resource route or a page loader:
 *
 * ```ts
 * export function loader({ request }: Route.LoaderArgs) {
 *   enforceRateLimit(request); // throws the 429 Response when over the limit
 *   // ...
 * }
 * ```
 *
 * A thrown `Response` is returned as-is from a resource route and reaches the
 * error boundary (with its status) from a page loader. Use `checkRateLimit` and
 * `rateLimitedResponse` instead when the caller wants to branch on the result.
 *
 * ## Client IP resolution (security-sensitive)
 *
 * `@react-router/serve` and the Vite dev server only give loaders a Web
 * `Request`, without the socket's peer address. So:
 *
 * 1. `X-Forwarded-For` is trusted only when `TRUST_PROXY_HOPS` (default 0) is
 *    set to the number of reverse proxies in front of the app. Each proxy
 *    appends the address it received the connection from, so the client is the
 *    entry `TRUST_PROXY_HOPS` positions from the right. Entries further left
 *    are client-supplied and ignored, so a client can't spoof its way into a
 *    fresh bucket. A missing, too short or malformed header means "unknown".
 * 2. With `TRUST_PROXY_HOPS=0`, a `clientAddress` passed by the caller (e.g.
 *    the socket address from a custom server) is used. The header is ignored.
 * 3. Otherwise the client is unknown and the request is **not** limited (fail
 *    open), with a one-time warning. One shared bucket for every unidentified
 *    request would let a single client lock all users out.
 *
 * IPv4-mapped IPv6 addresses count as IPv4. Other IPv6 clients are bucketed by
 * their /64 prefix, since one host usually controls a whole /64.
 *
 * ## Memory
 *
 * Windows live in an insertion-ordered `Map`, and a client's entry is
 * re-inserted when its new window starts, so entries are ordered by expiry.
 * Each check drops expired entries from the front (amortized O(1), no timers).
 * `maxKeys` caps the map if many distinct clients arrive within one window; the
 * oldest entry is evicted first.
 */
import { isIP } from 'node:net';

import { config } from './config.server';

export interface RateLimitResult {
  allowed: boolean;
  /** Bucket the request was counted against, or `null` when the client is unknown (not limited). */
  key: string | null;
  /** Max requests per window (0 when `key` is `null`). */
  limit: number;
  /** Requests left in the current window (0 when `key` is `null`). */
  remaining: number;
  /** Whole seconds until the current window resets (at least 1), or 0 when `key` is `null`. */
  retryAfterSeconds: number;
}

export interface RateLimiterOptions {
  windowMs: number;
  max: number;
  /** Cap on tracked clients. Default 10,000. */
  maxKeys?: number;
  /** Monotonic clock in ms. Default `performance.now`. */
  now?: () => number;
}

export interface RateLimiter {
  /** Counts one request for `key` and says whether it's allowed. */
  hit(key: string): RateLimitResult;
  /** Number of clients currently tracked. */
  size(): number;
}

export const DEFAULT_MAX_KEYS = 10_000;

interface Window {
  count: number;
  /** Clock time (ms) when this window ends. */
  resetAt: number;
}

/** A fixed-window counter per key, bounded in memory. */
export function createRateLimiter({
  windowMs,
  max,
  maxKeys = DEFAULT_MAX_KEYS,
  now = () => performance.now(),
}: RateLimiterOptions): RateLimiter {
  const windows = new Map<string, Window>();

  /** Entries are ordered by `resetAt`, so stop at the first live one. */
  function evictExpired(time: number): void {
    for (const [key, window] of windows) {
      if (window.resetAt > time) break;
      windows.delete(key);
    }
  }

  return {
    hit(key) {
      const time = now();
      evictExpired(time);

      let window = windows.get(key);
      if (!window) {
        if (windows.size >= maxKeys) {
          const oldest = windows.keys().next().value;
          if (oldest !== undefined) windows.delete(oldest);
        }
        window = { count: 0, resetAt: time + windowMs };
        windows.set(key, window);
      }

      const retryAfterSeconds = Math.max(1, Math.ceil((window.resetAt - time) / 1000));
      // Blocked requests aren't counted, so a client that keeps retrying isn't
      // pushed further out: it's let back in when its window resets.
      if (window.count >= max) {
        return { allowed: false, key, limit: max, remaining: 0, retryAfterSeconds };
      }
      window.count += 1;
      return { allowed: true, key, limit: max, remaining: max - window.count, retryAfterSeconds };
    },
    size() {
      return windows.size;
    },
  };
}

/**
 * Turns an address into a rate-limit bucket key, or `null` if it isn't an IP.
 * Accepts `[v6]:port` and `v4:port` forms, which some proxies emit.
 */
export function ipToKey(raw: string): string | null {
  let address = raw.trim();
  const bracketed = /^\[([^\]]+)\](?::\d+)?$/.exec(address);
  if (bracketed?.[1] !== undefined) address = bracketed[1];
  else if (/^[\d.]+:\d+$/.test(address)) address = address.slice(0, address.lastIndexOf(':'));
  address = address.replace(/%.*$/, ''); // IPv6 zone index, e.g. fe80::1%eth0

  const version = isIP(address);
  if (version === 4) return address;
  if (version !== 6) return null;

  const hextets = expandIpv6(address);
  if (hextets.slice(0, 5).every((h) => h === 0) && hextets[5] === 0xffff) {
    const [hi = 0, lo = 0] = hextets.slice(6);
    return [hi >> 8, hi & 0xff, lo >> 8, lo & 0xff].join('.');
  }
  return `${hextets
    .slice(0, 4)
    .map((h) => h.toString(16))
    .join(':')}::/64`;
}

/** The 8 hextets of a valid IPv6 address (any notation, including embedded IPv4). */
function expandIpv6(address: string): number[] {
  // WHATWG URL serialization gives a canonical form: lowercase hex only, at most one `::`.
  const canonical = new URL(`http://[${address}]/`).hostname.slice(1, -1);
  const [head = '', tail] = canonical.split('::');
  const parse = (part: string) => (part === '' ? [] : part.split(':').map((h) => parseInt(h, 16)));
  const left = parse(head);
  if (tail === undefined) return left;
  const right = parse(tail);
  return [...left, ...Array<number>(8 - left.length - right.length).fill(0), ...right];
}

export interface ClientKeyOptions {
  /** Number of trusted reverse proxies appending to `X-Forwarded-For`; 0 never trusts it. */
  trustProxyHops: number;
  /** Peer address of the connection, if the server exposes it. Used only when `trustProxyHops` is 0. */
  clientAddress?: string;
}

/** Resolves the rate-limit bucket for a request; `null` when the client can't be identified. */
export function resolveClientKey(
  request: Request,
  { trustProxyHops, clientAddress }: ClientKeyOptions,
): string | null {
  if (trustProxyHops > 0) {
    const header = request.headers.get('x-forwarded-for');
    if (!header) return null;
    const hops = header.split(',');
    const entry = hops[hops.length - trustProxyHops];
    return entry === undefined ? null : ipToKey(entry);
  }
  return clientAddress === undefined ? null : ipToKey(clientAddress);
}

let defaultLimiter: RateLimiter | undefined;

/** The process-wide limiter, configured from `RATE_LIMIT_MAX` / `RATE_LIMIT_WINDOW_MS`. */
function getDefaultLimiter(): RateLimiter {
  defaultLimiter ??= createRateLimiter({
    windowMs: config.rateLimit.windowMs,
    max: config.rateLimit.max,
  });
  return defaultLimiter;
}

let warnedUnknownClient = false;

export interface CheckRateLimitOptions {
  /** Peer address of the connection, if known (see `ClientKeyOptions.clientAddress`). */
  clientAddress?: string;
  /** Overrides for tests. Default: the process-wide limiter and `TRUST_PROXY_HOPS`. */
  limiter?: RateLimiter;
  trustProxyHops?: number;
}

/** Counts `request` against its client's window. Doesn't throw. */
export function checkRateLimit(
  request: Request,
  {
    clientAddress,
    limiter = getDefaultLimiter(),
    trustProxyHops = config.rateLimit.trustProxyHops,
  }: CheckRateLimitOptions = {},
): RateLimitResult {
  const key = resolveClientKey(request, { trustProxyHops, clientAddress });
  if (key === null) {
    if (!warnedUnknownClient) {
      warnedUnknownClient = true;
      console.warn(
        '[rate-limit] Could not resolve the client IP, so the request was not rate limited. ' +
          'Behind a reverse proxy, set TRUST_PROXY_HOPS to the number of proxies. ' +
          'This warning is shown once.',
      );
    }
    return { allowed: true, key: null, limit: 0, remaining: 0, retryAfterSeconds: 0 };
  }
  return limiter.hit(key);
}

export interface RateLimitedBody {
  error: {
    code: 'rate_limited';
    message: string;
  };
}

/** A `429 Too Many Requests` JSON response with `Retry-After`. Never cached. */
export function rateLimitedResponse(result: Pick<RateLimitResult, 'retryAfterSeconds'>): Response {
  const body: RateLimitedBody = {
    error: { code: 'rate_limited', message: 'Too many requests. Try again later.' },
  };
  return Response.json(body, {
    status: 429,
    headers: {
      'Retry-After': String(Math.max(1, result.retryAfterSeconds)),
      'Cache-Control': 'no-store',
    },
  });
}

/** Counts `request` and throws the 429 `Response` when the client is over its limit. */
export function enforceRateLimit(
  request: Request,
  options?: CheckRateLimitOptions,
): RateLimitResult {
  const result = checkRateLimit(request, options);
  if (!result.allowed) throw rateLimitedResponse(result);
  return result;
}
