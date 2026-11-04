/**
 * Turns failures in a **page loader** into a response the root `ErrorBoundary`
 * can map to an error state (questionnaire C16; ADR-0003).
 *
 * React Router sanitizes a thrown `Error` in production, so the browser can't
 * tell an `UpstreamError` from a bug. A thrown `data(PageErrorBody, { status })`
 * keeps its body and sets the page's HTTP status; the root `headers` export
 * passes its `Retry-After` and `Cache-Control: no-store` on to the document.
 *
 * | Thrown | Status | `kind` |
 * |---|---|---|
 * | `UpstreamUnavailableError` (Docker Hub failing or budget spent, nothing cached) | 503 | `unavailable` |
 * | `UpstreamError` that escaped `getCached` / `orNotFound` (e.g. a 404 from an endpoint that should always answer) | 503 | `unavailable` |
 * | The per-client 429 `Response` from `enforceRateLimit` | 429 | `rate_limited` |
 *
 * As on `/api/*` (`proxyJson`, ADR-0003), a spent budget or an upstream 429 is
 * a 503 "Docker Hub unavailable", not the client's 429. Anything else (a `400`
 * from `parseOrThrow`, `pageNotFound()`, a bug) is returned unchanged.
 *
 * A missing resource goes through the cache like any other answer, so repeated
 * misses don't spend the shared Docker Hub budget (CLAUDE.md hard rule 3):
 *
 * ```ts
 * export async function loader({ request }: Route.LoaderArgs) {
 *   try {
 *     enforceRateLimit(request);
 *     const result = await getCached(key, ttl, () => orNotFound(load()));
 *     if (result.value === null) throw pageNotFound('repo_not_found');
 *     return { repo: result.value, degraded: result.degraded };
 *   } catch (error) {
 *     throw toPageErrorResponse(error);
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

export type NotFoundKind = Extract<ErrorKind, 'not_found' | 'repo_not_found'>;

function pageError(status: number, body: PageErrorBody) {
  const headers = new Headers({ 'Cache-Control': 'no-store' });
  if (body.retryAfterSeconds !== undefined) {
    headers.set('Retry-After', String(body.retryAfterSeconds));
  }
  return data(body, { status, headers });
}

function unavailable(retryAfterSeconds: number) {
  return pageError(503, {
    kind: 'unavailable',
    retryAfterSeconds: Math.max(1, Math.ceil(retryAfterSeconds)),
  });
}

/** Whole seconds from a delta-seconds `Retry-After` header, if it has a positive one. */
function retryAfterOf(response: Response): number | undefined {
  const seconds = Number(response.headers.get('Retry-After'));
  return Number.isFinite(seconds) && seconds > 0 ? Math.ceil(seconds) : undefined;
}

/**
 * The `404` page for a resource that doesn't exist: throw it when the cached
 * value is `null` (see `orNotFound` in `app/server/api.server.ts`).
 */
export function pageNotFound(kind: NotFoundKind = 'not_found') {
  return pageError(404, { kind });
}

/** The thrown-`data()` equivalent of `error`, or `error` itself when it isn't a mapped failure. */
export function toPageErrorResponse(error: unknown): unknown {
  if (error instanceof UpstreamUnavailableError) return unavailable(error.retryAfterSeconds);

  if (error instanceof UpstreamError) {
    // `getCached` already turns the other kinds into `UpstreamUnavailableError`,
    // and `orNotFound` a 404 into `null`. A 404 that still escapes means the
    // endpoint changed, so it's a 503 as in `proxyJson`, not a "not found" page.
    if (error.kind === 'not_found') {
      console.error(`[page] Docker Hub ${error.endpoint} answered 404 unexpectedly`);
    }
    return unavailable(error.retryAfterSeconds ?? UNAVAILABLE_RETRY_AFTER_FALLBACK_SECONDS);
  }

  if (error instanceof Response && error.status === 429) {
    // The per-client limit: map it to a `PageErrorBody`, carrying `Retry-After`
    // in the body since the error boundary can't read headers.
    const retryAfterSeconds = retryAfterOf(error);
    return pageError(
      429,
      retryAfterSeconds === undefined
        ? { kind: 'rate_limited' }
        : { kind: 'rate_limited', retryAfterSeconds },
    );
  }

  return error;
}
