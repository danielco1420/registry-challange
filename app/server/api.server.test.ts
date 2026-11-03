/**
 * The shared `/api/*` plumbing. The routes themselves are tested end to end in
 * `app/routes/api-routes.test.ts`; this covers what they can't easily trigger.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  cacheKey,
  handleApi,
  methodNotAllowedResponse,
  notFoundResponse,
  orNotFound,
} from './api.server';
import { UpstreamError } from './dockerhub.server';

const request = new Request('http://localhost/api/popular');

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('handleApi', () => {
  it('returns the handler response', async () => {
    const res = await handleApi(request, () => Response.json({ ok: true }));
    expect(await res.json()).toEqual({ ok: true });
  });

  it('returns a thrown Response as is (e.g. a 400 from parseOrThrow)', async () => {
    const res = await handleApi(request, () => {
      throw new Response('bad', { status: 400 });
    });
    expect(res.status).toBe(400);
  });

  it('turns an unexpected error into a JSON 500 without its details, and logs it', async () => {
    const res = await handleApi(request, () => {
      throw new TypeError('secret detail');
    });
    expect(res.status).toBe(500);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    const text = await res.text();
    expect(JSON.parse(text)).toEqual({
      error: { code: 'internal_error', message: 'Something went wrong. Try again later.' },
    });
    expect(text).not.toContain('secret');
    expect(console.error).toHaveBeenCalled();
  });
});

describe('orNotFound', () => {
  it('maps an upstream 404 to null', async () => {
    const error = new UpstreamError('not_found', 'nope', { endpoint: 'repository', status: 404 });
    await expect(orNotFound(Promise.reject(error))).resolves.toBeNull();
  });

  it('rethrows other errors', async () => {
    const error = new UpstreamError('unavailable', 'down', { endpoint: 'repository' });
    await expect(orNotFound(Promise.reject(error))).rejects.toBe(error);
  });

  it('passes values through', async () => {
    await expect(orNotFound(Promise.resolve(1))).resolves.toBe(1);
  });
});

describe('cacheKey', () => {
  it("can't be made to collide by a separator in a part", () => {
    expect(cacheKey('search', 'a|b', 1)).not.toBe(cacheKey('search', 'a', 'b|1'));
    expect(cacheKey('search', 'a', undefined)).not.toBe(cacheKey('search', 'a'));
  });
});

it('methodNotAllowedResponse is a JSON 405 with Allow, never cached', async () => {
  const res = methodNotAllowedResponse();
  expect(res.status).toBe(405);
  expect(res.headers.get('Allow')).toBe('GET, HEAD');
  expect(res.headers.get('Cache-Control')).toBe('no-store');
  expect(await res.json()).toEqual({
    error: { code: 'method_not_allowed', message: 'Method not allowed' },
  });
});

it('notFoundResponse is a JSON 404, never cached', async () => {
  const res = notFoundResponse();
  expect(res.status).toBe(404);
  expect(res.headers.get('Cache-Control')).toBe('no-store');
  expect(await res.json()).toEqual({ error: { code: 'not_found', message: 'Not found' } });
});
