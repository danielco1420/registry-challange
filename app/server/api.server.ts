/**
 * Shared plumbing for the `/api/*` proxy resource routes (`app/routes/api.*.ts`,
 * docs/API.md "Proxy routes"). Each route:
 *
 * 1. runs inside `handleApi`, which applies the per-client rate limit and turns
 *    every failure into a JSON error (`{ error: { code, message } }`);
 * 2. validates its params with the schemas in `app/lib/params.ts`
 *    (`parseOrThrow`, a `400` on failure);
 * 3. answers through `proxyJson`, which reads via `getCached` and sets
 *    `X-Cache`, `Age` and `Cache-Control` (or answers `404` / `503`).
 */
import type { ApiErrorBody } from '../lib/dto';
import { upstreamBudget } from './budget.server';
import { UpstreamError } from './dockerhub.server';
import { enforceRateLimit } from './rateLimit.server';
import {
  UNAVAILABLE_RETRY_AFTER_FALLBACK_SECONDS,
  UpstreamUnavailableError,
  cachedJson,
  getCached,
  upstreamUnavailableResponse,
} from './upstream.server';

function errorJson(
  status: number,
  code: ApiErrorBody['error']['code'],
  message: string,
  headers: HeadersInit = { 'Cache-Control': 'no-store' },
): Response {
  const body: ApiErrorBody = { error: { code, message } };
  return Response.json(body, { status, headers });
}

/** `404` for a path outside the allowlist. Never cached. */
export function notFoundResponse(message = 'Not found'): Response {
  return errorJson(404, 'not_found', message);
}

/** `405` for a write method on a proxy route (they only answer `GET`/`HEAD`). Never cached. */
export function methodNotAllowedResponse(): Response {
  return errorJson(405, 'method_not_allowed', 'Method not allowed', {
    Allow: 'GET, HEAD',
    'Cache-Control': 'no-store',
  });
}

/**
 * The `action` of every proxy route: a JSON `405`, rate limited like any
 * `/api/*` request. Without it, React Router answers its own non-JSON 405.
 */
export function rejectWrite(request: Request): Promise<Response> {
  return handleApi(request, () => methodNotAllowedResponse());
}

/**
 * Runs a route handler with the per-client rate limit (ADR-0003). A thrown
 * `Response` (the `400` from `parseOrThrow`, the `429` from the rate limit) is
 * returned as is; anything else is logged and becomes a JSON `500`, so a
 * client never gets an HTML error page or a stack trace.
 */
export async function handleApi(
  request: Request,
  handler: () => Promise<Response> | Response,
): Promise<Response> {
  try {
    enforceRateLimit(request);
    return await handler();
  } catch (error) {
    if (error instanceof Response) return error;
    console.error(`[api] ${new URL(request.url).pathname} failed`, error);
    return errorJson(500, 'internal_error', 'Something went wrong. Try again later.');
  }
}

/** True for an upstream 404. */
export function isUpstreamNotFound(error: unknown): error is UpstreamError {
  return error instanceof UpstreamError && error.kind === 'not_found';
}

/**
 * Resolves to `null` when the upstream call answers 404, so `proxyJson` caches
 * "not found" like any other answer and repeated misses don't spend the shared
 * Docker Hub budget (CLAUDE.md hard rule 3). Other errors are rethrown.
 */
export async function orNotFound<T>(promise: Promise<T>): Promise<T | null> {
  try {
    return await promise;
  } catch (error) {
    if (isUpstreamNotFound(error)) return null;
    throw error;
  }
}

export interface ProxyJsonOptions<T> {
  /** Cache key: a resource prefix plus every validated param that changes the answer. */
  key: string;
  /** From `config.cache.ttlSeconds`. */
  ttlSeconds: number;
  /** Fetches and normalizes the DTO; `null` means "doesn't exist" (see `orNotFound`). */
  load: () => Promise<T | null>;
  /** Message of the `404` when `load` resolves to `null`. */
  notFoundMessage?: string;
}

/**
 * Reads through the cache and answers:
 * - `200` with the DTO, `X-Cache`, `Age` and `Cache-Control` (`public, max-age=<ttl>`,
 *   or `no-store` when stale);
 * - `404` `not_found` with the same cache headers when `load` gave `null`;
 * - `503` `upstream_unavailable` with `Retry-After` when nothing is cached and
 *   Docker Hub is failing or the budget is spent.
 *
 * An upstream 404 that `load` doesn't map to `null` (e.g. from a search
 * endpoint, which should always answer) means the endpoint is gone, so it's a
 * `503` as well.
 */
export async function proxyJson<T>({
  key,
  ttlSeconds,
  load,
  notFoundMessage = 'Not found',
}: ProxyJsonOptions<T>): Promise<Response> {
  try {
    const result = await getCached(key, ttlSeconds, load);
    if (result.value === null) {
      const body: ApiErrorBody = { error: { code: 'not_found', message: notFoundMessage } };
      return cachedJson(body, result, ttlSeconds, 404);
    }
    return cachedJson(result.value, result, ttlSeconds);
  } catch (error) {
    if (error instanceof UpstreamUnavailableError) return upstreamUnavailableResponse(error);
    if (isUpstreamNotFound(error)) {
      console.error(`[api] Docker Hub ${error.endpoint} answered 404 for ${key}`);
      // Like any other upstream failure (`getCached`): also wait for a free budget slot.
      return upstreamUnavailableResponse({
        retryAfterSeconds: Math.max(
          UNAVAILABLE_RETRY_AFTER_FALLBACK_SECONDS,
          upstreamBudget.retryAfterSeconds(),
        ),
      });
    }
    throw error;
  }
}

/** The query string of `request` as `URLSearchParams`. */
export const searchParamsOf = (request: Request) => new URL(request.url).searchParams;

/** A cache key from parts that can't collide (`a|b` vs `a` + `|b`). */
export const cacheKey = (resource: string, ...parts: (string | number | undefined)[]) =>
  `${resource}:${JSON.stringify(parts)}`;
