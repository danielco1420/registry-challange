import { afterEach, describe, expect, it, vi } from 'vitest';

import type { PageErrorBody } from '../lib/route-error';
import { UpstreamError, type UpstreamErrorKind } from './dockerhub.server';
import { pageNotFound, toPageErrorResponse } from './pageError.server';
import { rateLimitedResponse } from './rateLimit.server';
import {
  UNAVAILABLE_RETRY_AFTER_FALLBACK_SECONDS,
  UpstreamUnavailableError,
} from './upstream.server';

interface DataResult {
  data: PageErrorBody;
  init: { status: number; headers: Headers };
}

const upstream = (kind: UpstreamErrorKind, retryAfterSeconds?: number) =>
  new UpstreamError(kind, 'failed', { endpoint: 'repository', retryAfterSeconds });

const asData = (value: unknown) => value as DataResult;

afterEach(() => {
  vi.restoreAllMocks();
});

describe('pageNotFound', () => {
  it('is a 404 with the kind the page asks for, never cached downstream', () => {
    const generic = asData(pageNotFound());
    expect(generic.data).toEqual({ kind: 'not_found' });
    expect(generic.init.status).toBe(404);
    expect(generic.init.headers.get('Retry-After')).toBeNull();
    expect(generic.init.headers.get('Cache-Control')).toBe('no-store');

    expect(asData(pageNotFound('repo_not_found')).data).toEqual({ kind: 'repo_not_found' });
  });

  it('passes through toPageErrorResponse unchanged', () => {
    const notFound = pageNotFound('repo_not_found');
    expect(toPageErrorResponse(notFound)).toBe(notFound);
  });
});

describe('toPageErrorResponse', () => {
  it.each(['upstream_failed', 'budget_exhausted'] as const)(
    'maps UpstreamUnavailableError %s to 503 unavailable with Retry-After (ADR-0003)',
    (reason) => {
      const result = asData(toPageErrorResponse(new UpstreamUnavailableError(reason, 30.4)));
      expect(result.data).toEqual({ kind: 'unavailable', retryAfterSeconds: 31 });
      expect(result.init.status).toBe(503);
      expect(result.init.headers.get('Retry-After')).toBe('31');
      expect(result.init.headers.get('Cache-Control')).toBe('no-store');
    },
  );

  it.each(['rate_limited', 'budget_exhausted', 'unavailable', 'bad_payload'] as const)(
    'maps an UpstreamError %s that escaped getCached to 503 unavailable',
    (kind) => {
      const result = asData(toPageErrorResponse(upstream(kind, 8)));
      expect(result.data).toEqual({ kind: 'unavailable', retryAfterSeconds: 8 });
      expect(result.init.status).toBe(503);
      expect(result.init.headers.get('Retry-After')).toBe('8');
    },
  );

  it('maps an unexpected upstream 404 to 503, like proxyJson, and logs it', () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const result = asData(toPageErrorResponse(upstream('not_found')));
    expect(result.data).toEqual({
      kind: 'unavailable',
      retryAfterSeconds: UNAVAILABLE_RETRY_AFTER_FALLBACK_SECONDS,
    });
    expect(result.init.status).toBe(503);
    expect(log).toHaveBeenCalledOnce();
  });

  it('falls back to the default Retry-After when Docker Hub sent none', () => {
    const result = asData(toPageErrorResponse(upstream('unavailable')));
    expect(result.data.retryAfterSeconds).toBe(UNAVAILABLE_RETRY_AFTER_FALLBACK_SECONDS);
  });

  it('keeps the per-client 429 and moves its Retry-After into the body', () => {
    const result = asData(toPageErrorResponse(rateLimitedResponse({ retryAfterSeconds: 9 })));
    expect(result.data).toEqual({ kind: 'rate_limited', retryAfterSeconds: 9 });
    expect(result.init.status).toBe(429);
    expect(result.init.headers.get('Retry-After')).toBe('9');
    expect(result.init.headers.get('Cache-Control')).toBe('no-store');

    const noHeader = asData(toPageErrorResponse(new Response(null, { status: 429 })));
    expect(noHeader.data).toEqual({ kind: 'rate_limited' });
    expect(noHeader.init.headers.get('Retry-After')).toBeNull();
  });

  it('returns anything else unchanged', () => {
    const bug = new TypeError('bug');
    const badParams = new Response(null, { status: 400 });
    expect(toPageErrorResponse(bug)).toBe(bug);
    expect(toPageErrorResponse(badParams)).toBe(badParams);
  });
});
