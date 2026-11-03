/**
 * Integration tests for the `/api/*` proxy resource routes (T13, docs/API.md
 * "Proxy routes"). Requests go through React Router's static handler, built
 * from `app/routes.ts`, so path matching (including the `api/*` 404 splat) is
 * the real one; the routes use the real cache, budget and upstream client
 * against MSW serving the recorded Docker Hub fixtures.
 */
import { http, HttpResponse } from 'msw';
import {
  createStaticHandler,
  isRouteErrorResponse,
  type ActionFunction,
  type LoaderFunction,
  type RouteObject,
} from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ApiErrorBody, Page, Publisher, RepoDetails, SearchPage, Tag } from '../lib/dto';
import type { BadRequestBody } from '../lib/validate';
import routes from '../routes';
import { cache } from '../server/cache.server';
import { HUB, cloneFixture, dockerHubHandlers, fixtures } from '../../test/msw/dockerhub';
import { server } from '../../test/msw/server';

interface RouteModule {
  loader?: LoaderFunction;
  action?: ActionFunction;
}

const modules = import.meta.glob<RouteModule>('./api.*.ts', { eager: true });

const apiRoutes: RouteObject[] = routes
  .filter((entry) => entry.path?.startsWith('api/'))
  .map((entry) => {
    const module = modules[entry.file.replace(/^routes\//, './')];
    if (!module) throw new Error(`No module for ${entry.file}`);
    return { id: entry.file, path: entry.path, loader: module.loader, action: module.action };
  });

const handler = createStaticHandler(apiRoutes);

/** Sends a request through the router, the way the server answers a resource route. */
async function send(path: string, init?: RequestInit): Promise<Response> {
  const request = new Request(`http://localhost${path}`, init);
  try {
    const result: unknown = await handler.queryRoute(request);
    if (result instanceof Response) return result;
    throw new Error(`${path}: the loader didn't return a Response`);
  } catch (error) {
    if (error instanceof Response) return error;
    // The router's own 404 / 405 (no route, or a method the route doesn't handle).
    if (isRouteErrorResponse(error)) return new Response(null, { status: error.status });
    throw error;
  }
}

async function json<T>(path: string, init?: RequestInit): Promise<{ res: Response; body: T }> {
  const res = await send(path, init);
  return { res, body: (await res.json()) as T };
}

/** Upstream paths requested during the test. */
let calls: string[];

/** Every Docker Hub request answers 503 with a `Retry-After` too long to retry in-request. */
function upstreamDown() {
  server.use(
    http.all(`${HUB}/*`, () =>
      HttpResponse.json({ message: 'down' }, { status: 503, headers: { 'Retry-After': '60' } }),
    ),
  );
}

beforeEach(() => {
  cache.clear();
  calls = [];
  server.use(...dockerHubHandlers);
  server.events.on('request:start', ({ request }) => {
    const url = new URL(request.url);
    calls.push(`${url.pathname}${url.search}`);
  });
  // The rate limiter warns once that it can't identify the client (TRUST_PROXY_HOPS=0).
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  server.events.removeAllListeners();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function expectFresh(res: Response, xCache: 'MISS' | 'HIT', maxAge: number) {
  expect(res.headers.get('X-Cache')).toBe(xCache);
  expect(res.headers.get('Cache-Control')).toBe(`public, max-age=${maxAge}`);
  expect(res.headers.get('Age')).toMatch(/^\d+$/);
  expect(res.headers.get('Content-Type')).toMatch(/^application\/json/);
}

async function expectBadRequest(path: string, param: string) {
  const { res, body } = await json<BadRequestBody>(path);
  expect(res.status).toBe(400);
  expect(res.headers.get('Cache-Control')).toBe('no-store');
  expect(body.error.code).toBe('invalid_params');
  expect(body.error.issues.map((issue) => issue.param)).toContain(param);
  expect(calls).toEqual([]);
}

async function expectUnavailable(path: string) {
  const { res, body } = await json<ApiErrorBody>(path);
  expect(res.status).toBe(503);
  expect(res.headers.get('Cache-Control')).toBe('no-store');
  expect(res.headers.get('Retry-After')).toBe('60');
  expect(res.headers.get('X-Cache')).toBeNull();
  expect(body.error.code).toBe('upstream_unavailable');
}

async function expectNotFound(path: string, message: string, maxAge: number) {
  const { res, body } = await json<ApiErrorBody>(path);
  expect(res.status).toBe(404);
  expect(body).toEqual({ error: { code: 'not_found', message } });
  expectFresh(res, 'MISS', maxAge);
  // The miss is cached, so asking again doesn't spend the upstream budget.
  const upstreamCalls = calls.length;
  const again = await send(path);
  expect(again.status).toBe(404);
  expect(again.headers.get('X-Cache')).toBe('HIT');
  expect(calls).toHaveLength(upstreamCalls);
}

describe('GET /api/popular', () => {
  it('returns the 10 most pulled official images, then serves them from the cache', async () => {
    const { res, body } = await json<SearchPage>('/api/popular');
    expect(res.status).toBe(200);
    expectFresh(res, 'MISS', 600);
    expect(body).toMatchObject({ total: 181, page: 1, pageSize: 10, source: 'v4' });
    expect(body.items[0]).toMatchObject({ id: 'library/nginx', badge: 'official' });
    expect(body.items.length).toBeLessThanOrEqual(10);
    expect(calls).toEqual([
      '/api/search/v4?query=&from=0&size=10&sort=pull_count&order=desc&badges=official',
    ]);

    const again = await send('/api/popular?page=99');
    expectFresh(again, 'HIT', 600);
    expect(calls).toHaveLength(1);
  });

  it('upstream down with nothing cached: 503 with Retry-After', async () => {
    upstreamDown();
    await expectUnavailable('/api/popular');
  });

  it('upstream down with a stale entry: 200 STALE, not cacheable downstream', async () => {
    await send('/api/popular');
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.now() + 2 * 600_000);
    upstreamDown();

    const { res, body } = await json<SearchPage>('/api/popular');
    expect(res.status).toBe(200);
    expect(res.headers.get('X-Cache')).toBe('STALE');
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    expect(body.items[0]?.id).toBe('library/nginx');
  });

  it('an upstream 404 on search means the endpoint is gone: 503', async () => {
    server.use(http.get(`${HUB}/api/search/v4`, () => HttpResponse.json({}, { status: 404 })));
    const res = await send('/api/popular');
    expect(res.status).toBe(503);
    expect(res.headers.get('Retry-After')).toBe('5');
  });
});

describe('GET /api/search', () => {
  it('searches with defaults', async () => {
    const { res, body } = await json<SearchPage>('/api/search?q=nginx');
    expect(res.status).toBe(200);
    expectFresh(res, 'MISS', 60);
    expect(body).toMatchObject({ page: 1, pageSize: 25, source: 'v4' });
    expect(body.items[0]?.id).toBe('library/nginx');
    expect(calls).toEqual(['/api/search/v4?query=nginx&from=0&size=25']);
  });

  it('passes page, pageSize, sort and badge upstream, and caches per query', async () => {
    await send('/api/search?q=nginx&page=2&pageSize=10&sort=stars&badge=official');
    expect(calls).toEqual([
      '/api/search/v4?query=nginx&from=10&size=10&sort=star_count&order=desc&badges=official',
    ]);
    // Same validated query (trimmed q, unknown key ignored): a cache hit.
    const again = await send(
      '/api/search?q=%20nginx%20&page=2&pageSize=10&sort=stars&badge=official&x=1',
    );
    expect(again.headers.get('X-Cache')).toBe('HIT');
    // A different query: a miss.
    await send('/api/search?q=nginx&page=3&pageSize=10&sort=stars&badge=official');
    expect(calls).toHaveLength(2);
  });

  it('no results: 200 with an empty page', async () => {
    const { res, body } = await json<SearchPage>('/api/search?q=zzzz-nothing');
    expect(res.status).toBe(200);
    expect(body).toMatchObject({ items: [], total: 0 });
  });

  it('v4 drift: answers from the legacy search, flagged by `source`', async () => {
    const drifted = cloneFixture(fixtures.searchV4Nginx) as unknown as { total: unknown };
    drifted.total = 'many';
    server.use(http.get(`${HUB}/api/search/v4`, () => HttpResponse.json(drifted)));
    const { res, body } = await json<SearchPage>('/api/search?q=nginx');
    expect(res.status).toBe(200);
    expect(body.source).toBe('legacy');
    expect(body.items[0]?.id).toBe('library/nginx');
  });

  it.each([
    ['/api/search?page=0', 'page'],
    ['/api/search?pageSize=101', 'pageSize'],
    ['/api/search?sort=random', 'sort'],
    ['/api/search?badge=hardened', 'badge'],
    [`/api/search?q=${'a'.repeat(101)}`, 'q'],
    ['/api/search?q=a%00b', 'q'],
    // Docker Hub answers 403 past the first 1000 results without sign-in.
    ['/api/search?q=nginx&page=41&pageSize=25', 'page'],
  ])('bad params: %s → 400 on %s', async (path, param) => {
    await expectBadRequest(path, param);
  });

  it('upstream down: 503', async () => {
    upstreamDown();
    await expectUnavailable('/api/search?q=nginx');
  });
});

describe('GET /api/search/suggestions', () => {
  it('returns suggestions', async () => {
    const { res, body } = await json<SearchPage>('/api/search/suggestions?q=ngi');
    expect(res.status).toBe(200);
    expectFresh(res, 'MISS', 60);
    expect(body).toMatchObject({ page: 1, pageSize: 10, source: 'v4' });
    expect(body.items[0]?.id).toBe('library/nginx');
    expect(calls).toEqual(['/api/search/v4/suggestions?query=ngi']);
  });

  it.each([
    ['/api/search/suggestions', 'q'],
    ['/api/search/suggestions?q=%20%20', 'q'],
    [`/api/search/suggestions?q=${'a'.repeat(101)}`, 'q'],
  ])('bad params: %s → 400', async (path, param) => {
    await expectBadRequest(path, param);
  });

  it('upstream down: 503', async () => {
    upstreamDown();
    await expectUnavailable('/api/search/suggestions?q=ngi');
  });
});

describe('GET /api/repos/:ns/:repo', () => {
  it('returns an official repository', async () => {
    const { res, body } = await json<RepoDetails>('/api/repos/library/nginx');
    expect(res.status).toBe(200);
    expectFresh(res, 'MISS', 300);
    expect(body).toMatchObject({
      id: 'library/nginx',
      displayName: 'nginx',
      badge: 'official',
      archived: false,
    });
    expect(typeof body.fullDescriptionMd).toBe('string');
    expect(calls).toEqual(['/v2/namespaces/library/repositories/nginx']);
  });

  it('returns an archived repository (200, `archived: true`)', async () => {
    const { res, body } = await json<RepoDetails>('/api/repos/kernel528/archived');
    expect(res.status).toBe(200);
    expect(body).toMatchObject({ id: 'kernel528/archived', archived: true });
  });

  it('not found: 404, cached', async () => {
    await expectNotFound('/api/repos/library/does-not-exist', 'Repository not found', 300);
  });

  it.each([
    ['/api/repos/Library/nginx', 'ns'],
    ['/api/repos/library/nginx..x', 'repo'],
    ['/api/repos/library/..%2F..%2Fv2%2Fusers', 'repo'],
    ['/api/repos/library/nginx%2Ftags', 'repo'],
    [`/api/repos/library/${'a'.repeat(256)}`, 'repo'],
  ])('bad params: %s → 400 on %s', async (path, param) => {
    await expectBadRequest(path, param);
  });

  it('upstream down: 503', async () => {
    upstreamDown();
    await expectUnavailable('/api/repos/library/nginx');
  });
});

describe('GET /api/repos/:ns/:repo/tags', () => {
  it('returns a page of tags with the query passed upstream', async () => {
    const { res, body } = await json<Page<Tag>>(
      '/api/repos/fluent/fluent-bit/tags?page=2&pageSize=25&ordering=-last_updated&name=1.',
    );
    expect(res.status).toBe(200);
    expectFresh(res, 'MISS', 120);
    expect(body).toMatchObject({ total: 2189, page: 2, pageSize: 25 });
    expect(body.items.length).toBeGreaterThan(0);
    expect(calls).toEqual([
      '/v2/namespaces/fluent/repositories/fluent-bit/tags?page=2&page_size=25&ordering=-last_updated&name=1.',
    ]);
  });

  it('defaults, and drops attestation images', async () => {
    const { body } = await json<Page<Tag>>('/api/repos/library/nginx/tags');
    expect(body).toMatchObject({ page: 1, pageSize: 25 });
    const images = body.items.flatMap((tag) => tag.images);
    expect(images.length).toBeGreaterThan(0);
    expect(images.some((image) => image.arch === 'unknown')).toBe(false);
    expect(calls).toEqual(['/v2/namespaces/library/repositories/nginx/tags?page=1&page_size=25']);
  });

  it('not found: 404, cached', async () => {
    await expectNotFound('/api/repos/library/does-not-exist/tags', 'Repository not found', 120);
  });

  it('a 404 past the first page may be a page past the last one, and says so', async () => {
    await expectNotFound(
      '/api/repos/library/does-not-exist/tags?page=2',
      'Repository or page not found',
      120,
    );
  });

  it('a blank `name` filter shares the entry of no filter', async () => {
    await send('/api/repos/library/nginx/tags');
    const again = await send('/api/repos/library/nginx/tags?name=%20');
    expect(again.headers.get('X-Cache')).toBe('HIT');
    expect(calls).toHaveLength(1);
  });

  it.each([
    ['/api/repos/library/nginx/tags?page=11&pageSize=100', 'page'],
    ['/api/repos/library/nginx/tags?page=101', 'page'],
    ['/api/repos/library/nginx/tags?pageSize=0', 'pageSize'],
    ['/api/repos/library/nginx/tags?ordering=size', 'ordering'],
    ['/api/repos/library/nginx/tags?name=a%20b', 'name'],
    ['/api/repos/library/NGINX/tags', 'repo'],
  ])('bad params: %s → 400 on %s', async (path, param) => {
    await expectBadRequest(path, param);
  });

  it('upstream down: 503', async () => {
    upstreamDown();
    await expectUnavailable('/api/repos/library/nginx/tags');
  });
});

describe('GET /api/repos/:ns/:repo/tags/:tag', () => {
  it('returns one tag', async () => {
    const { res, body } = await json<Tag>('/api/repos/library/nginx/tags/latest');
    expect(res.status).toBe(200);
    expectFresh(res, 'MISS', 120);
    expect(body.name).toBe('latest');
    expect(calls).toEqual(['/v2/namespaces/library/repositories/nginx/tags/latest']);
  });

  it('not found: 404, cached', async () => {
    await expectNotFound('/api/repos/library/nginx/tags/no-such-tag', 'Tag not found', 120);
  });

  it.each([
    ['/api/repos/library/nginx/tags/-latest', 'tag'],
    ['/api/repos/library/nginx/tags/.hidden', 'tag'],
    [`/api/repos/library/nginx/tags/${'a'.repeat(129)}`, 'tag'],
    ['/api/repos/library/nginx/tags/a%2Fb', 'tag'],
  ])('bad params: %s → 400 on %s', async (path, param) => {
    await expectBadRequest(path, param);
  });

  it('upstream down: 503', async () => {
    upstreamDown();
    await expectUnavailable('/api/repos/library/nginx/tags/latest');
  });
});

describe('GET /api/publishers/:name', () => {
  it('returns an org', async () => {
    const { res, body } = await json<Publisher>('/api/publishers/docker');
    expect(res.status).toBe(200);
    expectFresh(res, 'MISS', 3600);
    expect(body).toMatchObject({
      name: 'docker',
      kind: 'organization',
      badge: 'verified_publisher',
    });
    expect(calls).toEqual(['/v2/orgs/docker']);
  });

  it('falls back to the user endpoint when there is no such org', async () => {
    const { res, body } = await json<Publisher>('/api/publishers/kernel528');
    expect(res.status).toBe(200);
    expect(body).toMatchObject({ name: 'kernel528', kind: 'user', badge: 'none' });
    expect(calls).toEqual(['/v2/orgs/kernel528', '/v2/users/kernel528']);
  });

  it('not found (neither an org nor a user): 404, cached', async () => {
    await expectNotFound('/api/publishers/nobody-here', 'Publisher not found', 3600);
    expect(calls).toEqual(['/v2/orgs/nobody-here', '/v2/users/nobody-here']);
  });

  it.each([
    ['/api/publishers/Docker', 'name'],
    ['/api/publishers/a..b', 'name'],
    ['/api/publishers/a%40b', 'name'],
  ])('bad params: %s → 400', async (path, param) => {
    await expectBadRequest(path, param);
  });

  it('upstream down: 503', async () => {
    upstreamDown();
    await expectUnavailable('/api/publishers/docker');
  });
});

describe('outside the allowlist', () => {
  it.each([
    '/api',
    '/api/',
    '/api/nope',
    '/api/repos/library',
    '/api/repos/library/nginx/extra',
    '/api/repos/library/nginx/tags/latest/images',
    '/api/search/v4?query=nginx',
    '/api/v2/namespaces/library/repositories/nginx',
    '/api/publishers',
    '/api/https%3A%2F%2Fexample.com',
    // Dot segments (encoded or not) are resolved by the URL parser before routing.
    '/api/publishers/%2E%2E',
    '/api/repos/library/nginx/%2E%2E/%2E%2E/%2E%2E/v2/users/docker',
  ])('GET %s → JSON 404, nothing forwarded', async (path) => {
    const { res, body } = await json<ApiErrorBody>(path);
    expect(res.status).toBe(404);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    expect(body).toEqual({ error: { code: 'not_found', message: 'Not found' } });
    expect(calls).toEqual([]);
  });

  it('any method on an unknown path → JSON 404', async () => {
    const res = await send('/api/nope', { method: 'POST' });
    expect(res.status).toBe(404);
    expect(((await res.json()) as ApiErrorBody).error.code).toBe('not_found');
  });

  it.each([
    ['DELETE', '/api/repos/library/nginx'],
    ['POST', '/api/popular'],
    ['POST', '/api/search?q=nginx'],
    ['PUT', '/api/search/suggestions?q=ngi'],
    ['PATCH', '/api/repos/library/nginx/tags'],
    ['POST', '/api/repos/library/nginx/tags/latest'],
    ['POST', '/api/publishers/docker'],
  ])('%s %s → JSON 405, nothing forwarded', async (method, path) => {
    const { res, body } = await json<ApiErrorBody>(path, { method });
    expect(res.status).toBe(405);
    expect(res.headers.get('Allow')).toBe('GET, HEAD');
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    expect(body.error.code).toBe('method_not_allowed');
    expect(calls).toEqual([]);
  });

  it('/api/health still answers', async () => {
    const res = await send('/api/health');
    expect(res.status).toBe(200);
  });
});
