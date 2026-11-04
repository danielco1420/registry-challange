/**
 * The Tags tab's loader (`loadRepoTagsTab`, T25): success, empty, filter and
 * error results, paging past the end, and the cache entry it shares with
 * `GET /api/repos/:ns/:repo/tags`. Upstream calls go to MSW serving the
 * recorded Docker Hub fixtures.
 */
import { http, HttpResponse } from 'msw';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { TagsTabData } from '../lib/tags-query';
import { loader as apiTagsLoader } from '../routes/api.repos.$ns.$repo.tags';
import { HUB, dockerHubHandlers, fixtures } from '../../test/msw/dockerhub';
import { server } from '../../test/msw/server';
import { cache } from './cache.server';
import type * as RateLimitModule from './rateLimit.server';
import { loadRepoTagsTab } from './tags.server';

const rateLimit = vi.hoisted(() => ({ over: false }));
vi.mock('./rateLimit.server', async (importOriginal) => {
  const actual = await importOriginal<typeof RateLimitModule>();
  return {
    ...actual,
    checkRateLimit: (...args: Parameters<typeof actual.checkRateLimit>) =>
      rateLimit.over
        ? { allowed: false, key: 'test', limit: 1, remaining: 0, retryAfterSeconds: 7.2 }
        : actual.checkRateLimit(...args),
  };
});

/** Upstream URLs requested during the test. */
let calls: URL[];

beforeEach(() => {
  cache.clear();
  calls = [];
  rateLimit.over = false;
  server.use(...dockerHubHandlers);
  server.events.on('request:start', ({ request }) => {
    calls.push(new URL(request.url));
  });
  // The rate limiter warns once that it can't identify the client (TRUST_PROXY_HOPS=0).
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  server.events.removeAllListeners();
  vi.restoreAllMocks();
});

const TAGS_PATH = '/v2/namespaces/:ns/repositories/:repo/tags';

function load(params: { ns?: string; repo?: string }, path: string): Promise<TagsTabData> {
  return loadRepoTagsTab({ request: new Request(`http://localhost${path}`), params });
}

const fluentBit = (search = '') =>
  load({ ns: 'fluent', repo: 'fluent-bit' }, `/r/fluent/fluent-bit/tags${search}`);

function expectOk(data: TagsTabData) {
  if (!data.result.ok) throw new Error(`expected ok, got ${data.result.error}`);
  return data.result;
}

describe('loadRepoTagsTab', () => {
  it('loads the first page, newest first, 50 at a time', async () => {
    const data = await fluentBit();

    expect(data).toMatchObject({ ordering: 'last_updated', name: '', page: 1 });
    const { tags, degraded } = expectOk(data);
    expect(degraded).toBe(false);
    expect(tags.total).toBe(fixtures.tagsFluentBit.count);
    expect(tags.page).toBe(1);
    expect(tags.pageSize).toBe(50);
    expect(tags.items[0]?.name).toBe(fixtures.tagsFluentBit.results[0]?.name);

    expect(calls).toHaveLength(1);
    expect(calls[0]?.pathname).toBe('/v2/namespaces/fluent/repositories/fluent-bit/tags');
    expect(Object.fromEntries(calls[0]!.searchParams)).toEqual({
      page: '1',
      page_size: '50',
      ordering: 'last_updated',
    });
  });

  it('/_/:repo loads the official repository from `library`', async () => {
    const data = await load({ repo: 'nginx' }, '/_/nginx/tags');
    expect(expectOk(data).tags.total).toBe(fixtures.tagsNginx.count);
    expect(calls.map((url) => url.pathname)).toEqual([
      '/v2/namespaces/library/repositories/nginx/tags',
    ]);
  });

  it('passes the sort, the name filter and the page upstream', async () => {
    const data = await fluentBit('?ordering=-name&name=%203.1%20&page=3');

    expect(data).toMatchObject({ ordering: '-name', name: '3.1', page: 3 });
    expect(Object.fromEntries(calls[0]!.searchParams)).toEqual({
      page: '3',
      page_size: '50',
      ordering: '-name',
      name: '3.1',
    });
  });

  it('shares its cache entry with GET /api/repos/:ns/:repo/tags: one upstream call', async () => {
    await fluentBit('?name=3.1');
    const res = (await apiTagsLoader({
      request: new Request(
        'http://localhost/api/repos/fluent/fluent-bit/tags?pageSize=50&ordering=last_updated&name=3.1',
      ),
      params: { ns: 'fluent', repo: 'fluent-bit' },
    } as Parameters<typeof apiTagsLoader>[0])) as Response;

    expect(res.status).toBe(200);
    expect(res.headers.get('X-Cache')).toBe('HIT');
    expect(calls).toHaveLength(1);
  });

  it('a repository without tags: an empty page', async () => {
    server.use(
      http.get(`${HUB}${TAGS_PATH}`, () =>
        HttpResponse.json({ count: 0, next: null, previous: null, results: [] }),
      ),
    );
    const { tags } = expectOk(await fluentBit());
    expect(tags.items).toEqual([]);
    expect(tags.total).toBe(0);
  });

  it('a filter nothing matches: an empty page, with the filter echoed', async () => {
    server.use(
      http.get(`${HUB}${TAGS_PATH}`, () =>
        HttpResponse.json({ count: 0, next: null, previous: null, results: [] }),
      ),
    );
    const data = await fluentBit('?name=nope');
    expect(data.name).toBe('nope');
    expect(expectOk(data).tags.items).toEqual([]);
  });

  it.each(['alp*', 'a%20b', 'x'.repeat(129)])(
    'a filter no tag could match (%s): an empty page, without an upstream call',
    async (name) => {
      const data = await fluentBit(`?name=${name}`);
      expect(expectOk(data).tags.items).toEqual([]);
      expect(calls).toEqual([]);
    },
  );

  it.each([
    [{ ns: 'Fluent', repo: 'fluent-bit' }],
    [{ ns: 'fluent', repo: '../../v2/users' }],
    [{ ns: 'fluent' }],
  ])('invalid params %j: "repository not found", no upstream call', async (params) => {
    const data = await load(params, '/r/x/y/tags');
    expect(data.result).toEqual({ ok: false, error: 'repo_not_found' });
    expect(calls).toEqual([]);
  });

  it('a missing repository: "repository not found", cached', async () => {
    await load({ ns: 'nobody', repo: 'nothing' }, '/r/nobody/nothing/tags');
    const data = await load({ ns: 'nobody', repo: 'nothing' }, '/r/nobody/nothing/tags');
    expect(data.result).toEqual({ ok: false, error: 'repo_not_found' });
    expect(calls).toHaveLength(1);
  });

  it('a 404 past page 1 is the end of the list, not a missing repository', async () => {
    server.use(
      http.get(`${HUB}${TAGS_PATH}`, () =>
        HttpResponse.json(fixtures.errorNotFound, { status: 404 }),
      ),
    );
    const data = await fluentBit('?page=5');
    expect(data.page).toBe(5);
    expect(expectOk(data).tags).toMatchObject({ items: [], page: 5 });
  });

  it('Docker Hub down with nothing cached: "unavailable" with Retry-After', async () => {
    server.use(
      http.all(`${HUB}/*`, () =>
        HttpResponse.json({ message: 'down' }, { status: 503, headers: { 'Retry-After': '60' } }),
      ),
    );
    const data = await fluentBit();
    expect(data.result).toEqual({ ok: false, error: 'unavailable', retryAfterSeconds: 60 });
  });

  it('over the per-client limit: "rate limited", without an upstream call', async () => {
    rateLimit.over = true;
    const data = await fluentBit();
    expect(data.result).toEqual({ ok: false, error: 'rate_limited', retryAfterSeconds: 8 });
    expect(calls).toEqual([]);
  });
});
