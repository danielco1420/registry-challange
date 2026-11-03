/**
 * Maps whatever a route throws to one of the error states the UI shows
 * (questionnaire C16, D25; ADR-0003). Client-safe: no server imports.
 *
 * React Router replaces a thrown `Error` with a generic one in production
 * before it reaches the browser, so the client can't check
 * `instanceof UpstreamError`. Page loaders turn upstream failures into a
 * thrown `data(PageErrorBody, { status })` instead (`toPageErrorResponse` in
 * `app/server/pageError.server.ts`), which keeps its body and status.
 */
import { isRouteErrorResponse } from 'react-router';

export const ERROR_KINDS = [
  'not_found',
  'repo_not_found',
  'unavailable',
  'rate_limited',
  'unexpected',
] as const;
export type ErrorKind = (typeof ERROR_KINDS)[number];

/** The kinds whose next action is "try again". The others send the user back to Explore. */
export const RETRYABLE_KINDS = [
  'unavailable',
  'rate_limited',
  'unexpected',
] as const satisfies readonly ErrorKind[];
export type RetryableKind = (typeof RETRYABLE_KINDS)[number];

export function isRetryable(kind: ErrorKind): kind is RetryableKind {
  return (RETRYABLE_KINDS as readonly ErrorKind[]).includes(kind);
}

/** The body of an error response thrown by a page loader. */
export interface PageErrorBody {
  kind: ErrorKind;
  /** Whole seconds, from `Retry-After`, when the server knows when to retry. */
  retryAfterSeconds?: number;
}

export interface RouteErrorInfo {
  kind: ErrorKind;
  retryAfterSeconds?: number;
  /** True when a loader threw a response, so revalidating can recover; false for a render error. */
  isResponse: boolean;
}

function isErrorKind(value: unknown): value is ErrorKind {
  return typeof value === 'string' && (ERROR_KINDS as readonly string[]).includes(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** `{ error: { code } }` from an `/api/*` response or the rate limiter (`ApiErrorBody`). */
function kindOfApiCode(data: unknown): ErrorKind | undefined {
  if (!isRecord(data) || !isRecord(data.error)) return undefined;
  switch (data.error.code) {
    case 'not_found':
    case 'invalid_params':
      return 'not_found';
    case 'rate_limited':
      return 'rate_limited';
    case 'upstream_unavailable':
      return 'unavailable';
    case 'internal_error':
      return 'unexpected';
    default:
      return undefined;
  }
}

function kindOfStatus(status: number): ErrorKind {
  if (status === 400 || status === 404) return 'not_found';
  if (status === 429) return 'rate_limited';
  if (status === 502 || status === 503 || status === 504) return 'unavailable';
  return 'unexpected';
}

function positiveSeconds(value: unknown): number | undefined {
  const seconds = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds <= 0) return undefined;
  return Math.ceil(seconds);
}

/**
 * The error state for `error`, as received by an `ErrorBoundary`:
 * - a `PageErrorBody` keeps its `kind` (so `repo_not_found` survives);
 * - an `ApiErrorBody` maps by `code`;
 * - any other response maps by status: `400`/`404` not found, `429` rate
 *   limited, `502`/`503`/`504` unavailable, anything else unexpected;
 * - a thrown `Error` (or anything else) is unexpected.
 */
export function classifyRouteError(error: unknown): RouteErrorInfo {
  if (!isRouteErrorResponse(error)) return { kind: 'unexpected', isResponse: false };

  const data: unknown = error.data;
  const kind =
    (isRecord(data) && isErrorKind(data.kind) ? data.kind : undefined) ??
    kindOfApiCode(data) ??
    kindOfStatus(error.status);
  const retryAfterSeconds = isRecord(data) ? positiveSeconds(data.retryAfterSeconds) : undefined;

  return retryAfterSeconds === undefined
    ? { kind, isResponse: true }
    : { kind, retryAfterSeconds, isResponse: true };
}
