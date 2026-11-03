/**
 * Turns upstream failures in a **page loader** into a response the root
 * `ErrorBoundary` can map to an error state (questionnaire C16; ADR-0003).
 *
 * React Router sanitizes a thrown `Error` in production, so the browser can't
 * tell an `UpstreamError` from a bug. A thrown `data(PageErrorBody, { status })`
 * keeps its body and sets the page's HTTP status:
 *
 * | Error | Status | `kind` |
 * |---|---|---|
 * | `UpstreamError` `not_found` | 404 | `notFound` option (`not_found` by default) |
 * | `UpstreamError` `rate_limited` / `budget_exhausted`, `UpstreamUnavailableError` `budget_exhausted` | 429 | `rate_limited` |
 * | `UpstreamError` `unavailable` / `bad_payload`, `UpstreamUnavailableError` `upstream_failed` | 503 | `unavailable` |
 *
 * Anything else (a thrown `Response`, a bug) is returned unchanged.
 *
 * ```ts
 * export async function loader({ params }: Route.LoaderArgs) {
 *   try {
 *     const result = await getCached(key, ttl, load);
 *     return { repo: result.value, degraded: result.degraded };
 *   } catch (error) {
 *     throw toPageErrorResponse(error, { notFound: 'repo_not_found' });
 *   }
 * }
 * ```
 */
import { data } from 'react-router';

import type { ErrorKind, PageErrorBody } from '../lib/route-error';
import { UpstreamError } from './dockerhub.server';
import {
  UNAVAILABLE_RETRY_AFTER_FALLBACK_SECONDS,
  UpstreamUnavailableError,
} from './upstream.server';

export interface PageErrorOptions {
  /** The kind shown for an upstream 404, e.g. `repo_not_found` on the repository page. */
  notFound?: Extract<ErrorKind, 'not_found' | 'repo_not_found'>;
}

function pageError(status: number, body: PageErrorBody) {
  const headers = new Headers({ 'Cache-Control': 'no-store' });
  if (body.retryAfterSeconds !== undefined) {
    headers.set('Retry-After', String(body.retryAfterSeconds));
  }
  return data(body, { status, headers });
}

const wholeSeconds = (seconds: number) => Math.max(1, Math.ceil(seconds));

/** The thrown-`data()` equivalent of `error`, or `error` itself when it isn't an upstream failure. */
export function toPageErrorResponse(error: unknown, options: PageErrorOptions = {}): unknown {
  if (error instanceof UpstreamUnavailableError) {
    const retryAfterSeconds = wholeSeconds(error.retryAfterSeconds);
    return error.reason === 'budget_exhausted'
      ? pageError(429, { kind: 'rate_limited', retryAfterSeconds })
      : pageError(503, { kind: 'unavailable', retryAfterSeconds });
  }

  if (error instanceof UpstreamError) {
    const retryAfterSeconds = wholeSeconds(
      error.retryAfterSeconds ?? UNAVAILABLE_RETRY_AFTER_FALLBACK_SECONDS,
    );
    switch (error.kind) {
      case 'not_found':
        return pageError(404, { kind: options.notFound ?? 'not_found' });
      case 'rate_limited':
      case 'budget_exhausted':
        return pageError(429, { kind: 'rate_limited', retryAfterSeconds });
      case 'unavailable':
      case 'bad_payload':
        return pageError(503, { kind: 'unavailable', retryAfterSeconds });
    }
  }

  return error;
}
