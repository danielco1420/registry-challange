import { describe, expect, it } from 'vitest';

import type { PageErrorBody } from '../lib/route-error';
import { UpstreamError, type UpstreamErrorKind } from './dockerhub.server';
import { toPageErrorResponse } from './pageError.server';
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

describe('toPageErrorResponse', () => {
  it('maps an upstream 404 to not_found, or to the kind the page asks for', () => {
    const generic = asData(toPageErrorResponse(upstream('not_found')));
    expect(generic.data).toEqual({ kind: 'not_found' });
    expect(generic.init.status).toBe(404);
    expect(generic.init.headers.get('Retry-After')).toBeNull();

    const repo = asData(toPageErrorResponse(upstream('not_found'), { notFound: 'repo_not_found' }));
    expect(repo.data).toEqual({ kind: 'repo_not_found' });
    expect(repo.init.status).toBe(404);
  });

  it.each([
    ['rate_limited', 429, 'rate_limited'],
    ['budget_exhausted', 429, 'rate_limited'],
    ['unavailable', 503, 'unavailable'],
    ['bad_payload', 503, 'unavailable'],
  ] as const)('maps UpstreamError %s to %i %s with Retry-After', (kind, status, pageKind) => {
    const result = asData(toPageErrorResponse(upstream(kind, 8)));
    expect(result.data).toEqual({ kind: pageKind, retryAfterSeconds: 8 });
    expect(result.init.status).toBe(status);
    expect(result.init.headers.get('Retry-After')).toBe('8');
    expect(result.init.headers.get('Cache-Control')).toBe('no-store');
  });

  it('falls back to the default Retry-After when Docker Hub sent none', () => {
    const result = asData(toPageErrorResponse(upstream('unavailable')));
    expect(result.data.retryAfterSeconds).toBe(UNAVAILABLE_RETRY_AFTER_FALLBACK_SECONDS);
  });

  it('maps UpstreamUnavailableError by reason', () => {
    const budget = asData(
      toPageErrorResponse(new UpstreamUnavailableError('budget_exhausted', 30.4)),
    );
    expect(budget.data).toEqual({ kind: 'rate_limited', retryAfterSeconds: 31 });
    expect(budget.init.status).toBe(429);

    const failed = asData(toPageErrorResponse(new UpstreamUnavailableError('upstream_failed', 5)));
    expect(failed.data).toEqual({ kind: 'unavailable', retryAfterSeconds: 5 });
    expect(failed.init.status).toBe(503);
    expect(failed.init.headers.get('Retry-After')).toBe('5');
  });

  it('returns anything else unchanged', () => {
    const bug = new TypeError('bug');
    const thrown = new Response(null, { status: 429 });
    expect(toPageErrorResponse(bug)).toBe(bug);
    expect(toPageErrorResponse(thrown)).toBe(thrown);
  });
});
