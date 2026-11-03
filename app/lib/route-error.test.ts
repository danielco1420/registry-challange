import { UNSAFE_ErrorResponseImpl as ErrorResponse } from 'react-router';
import { describe, expect, it } from 'vitest';

import { classifyRouteError, isRetryable } from './route-error';

// What an ErrorBoundary receives for a thrown `data()` or `Response`.
const response = (status: number, data: unknown) => new ErrorResponse(status, 'status text', data);

describe('classifyRouteError', () => {
  it('keeps the kind and Retry-After of a PageErrorBody', () => {
    expect(classifyRouteError(response(404, { kind: 'repo_not_found' }))).toEqual({
      kind: 'repo_not_found',
      isResponse: true,
    });
    expect(
      classifyRouteError(response(429, { kind: 'rate_limited', retryAfterSeconds: 12 })),
    ).toEqual({ kind: 'rate_limited', retryAfterSeconds: 12, isResponse: true });
  });

  it.each([
    ['not_found', 404, 'not_found'],
    ['invalid_params', 400, 'not_found'],
    ['rate_limited', 429, 'rate_limited'],
    ['upstream_unavailable', 503, 'unavailable'],
    ['internal_error', 500, 'unexpected'],
  ] as const)('maps the ApiErrorBody code %s', (code, status, kind) => {
    expect(classifyRouteError(response(status, { error: { code, message: 'x' } }))).toEqual({
      kind,
      isResponse: true,
    });
  });

  it.each([
    [400, 'not_found'],
    [404, 'not_found'],
    [429, 'rate_limited'],
    [502, 'unavailable'],
    [503, 'unavailable'],
    [504, 'unavailable'],
    [500, 'unexpected'],
    [403, 'unexpected'],
  ] as const)('maps any other %i response by status to %s', (status, kind) => {
    // An unmatched URL gives React Router's own 404 with a string body.
    expect(classifyRouteError(response(status, 'Not Found')).kind).toBe(kind);
  });

  it('ignores an unknown kind and falls back to the status', () => {
    expect(classifyRouteError(response(503, { kind: 'teapot' })).kind).toBe('unavailable');
  });

  it('only keeps a positive, finite Retry-After, rounded up', () => {
    const retryAfter = (value: unknown) =>
      classifyRouteError(response(503, { kind: 'unavailable', retryAfterSeconds: value }))
        .retryAfterSeconds;
    expect(retryAfter(2.2)).toBe(3);
    expect(retryAfter('7')).toBe(7);
    expect(retryAfter(0)).toBeUndefined();
    expect(retryAfter(-1)).toBeUndefined();
    expect(retryAfter(Number.POSITIVE_INFINITY)).toBeUndefined();
    expect(retryAfter('soon')).toBeUndefined();
    expect(retryAfter('')).toBeUndefined();
  });

  it('treats a thrown Error, or anything else, as unexpected', () => {
    expect(classifyRouteError(new Error('boom'))).toEqual({
      kind: 'unexpected',
      isResponse: false,
    });
    expect(classifyRouteError(undefined)).toEqual({ kind: 'unexpected', isResponse: false });
  });
});

describe('isRetryable', () => {
  it('is true only for the kinds whose next action is "try again"', () => {
    expect(isRetryable('unavailable')).toBe(true);
    expect(isRetryable('rate_limited')).toBe(true);
    expect(isRetryable('unexpected')).toBe(true);
    expect(isRetryable('not_found')).toBe(false);
    expect(isRetryable('repo_not_found')).toBe(false);
  });
});
