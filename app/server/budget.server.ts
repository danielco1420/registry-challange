/**
 * Proxy-wide upstream budget (ADR-0003, RISKS 1.1).
 *
 * Every user's traffic leaves from the proxy's IP, so all of them share one
 * anonymous Docker Hub limit (~180 req/min). This limiter caps our own upstream
 * attempts at `UPSTREAM_BUDGET_PER_MIN` (at most 150) in **any** 60 s span.
 *
 * It is a sliding-window log, not a fixed window: a fixed window would allow
 * `2 × limit` requests in a burst around a window edge, which is over Docker
 * Hub's limit. The log is a ring buffer of the last `limit` acquisition times,
 * so memory is O(limit) and each call is O(1).
 *
 * Who counts: the Docker Hub client calls `tryAcquire()` right before each
 * attempt, retries included. Cache hits and single-flight followers never
 * reach the client, so they don't count.
 *
 * State is in memory, per process, like the cache: lost on restart and not
 * shared across instances (RISKS 2.7).
 */
import { config } from './config.server';

/** The budget is per minute (ADR-0003). */
export const BUDGET_WINDOW_MS = 60_000;

export interface UpstreamBudgetOptions {
  /** Max acquisitions in any `windowMs` span. A whole number >= 1. */
  limit: number;
  /** Default `BUDGET_WINDOW_MS`. */
  windowMs?: number;
  /** Monotonic clock in ms. Default `performance.now`. */
  now?: () => number;
}

export interface UpstreamBudget {
  /** Takes one slot and returns true, or returns false (taking nothing) when the budget is spent. */
  tryAcquire(): boolean;
  /** Slots left right now. */
  remaining(): number;
  /** True when the next `tryAcquire()` would fail. */
  isExhausted(): boolean;
  /**
   * Whole seconds until a slot frees up (at least 1) when exhausted, else 0.
   * This is the "seconds until budget reset" of the 503 `Retry-After`.
   */
  retryAfterSeconds(): number;
  readonly limit: number;
}

export function createUpstreamBudget({
  limit,
  windowMs = BUDGET_WINDOW_MS,
  now = () => performance.now(),
}: UpstreamBudgetOptions): UpstreamBudget {
  if (!Number.isInteger(limit) || limit < 1) {
    throw new RangeError(`limit must be a whole number >= 1, got ${limit}`);
  }
  if (!Number.isFinite(windowMs) || windowMs <= 0) {
    throw new RangeError(`windowMs must be a positive number, got ${windowMs}`);
  }

  /** Acquisition times, oldest at `head`. Holds at most `limit` entries. */
  const times = new Array<number>(limit).fill(0);
  let head = 0;
  let count = 0;

  /** Drops acquisitions older than the window. */
  function prune(time: number): void {
    while (count > 0 && (times[head] ?? 0) + windowMs <= time) {
      head = (head + 1) % limit;
      count -= 1;
    }
  }

  return {
    limit,
    tryAcquire() {
      const time = now();
      prune(time);
      if (count >= limit) return false;
      times[(head + count) % limit] = time;
      count += 1;
      return true;
    },
    remaining() {
      prune(now());
      return limit - count;
    },
    isExhausted() {
      prune(now());
      return count >= limit;
    },
    retryAfterSeconds() {
      const time = now();
      prune(time);
      if (count < limit) return 0;
      const oldest = times[head] ?? time;
      return Math.max(1, Math.ceil((oldest + windowMs - time) / 1000));
    },
  };
}

/** The process-wide budget, `UPSTREAM_BUDGET_PER_MIN` per minute. */
export const upstreamBudget: UpstreamBudget = createUpstreamBudget({
  limit: config.upstream.budgetPerMin,
});
