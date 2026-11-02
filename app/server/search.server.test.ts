/**
 * Search with the legacy fallback, end to end through the real upstream
 * client against MSW serving the recorded fixtures (RISKS.md 1.3).
 */
import { http, HttpResponse } from 'msw';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SearchQuery } from '../lib/params';
import { HUB, cloneFixture, dockerHubHandlers, fixtures } from '../../test/msw/dockerhub';
import { server } from '../../test/msw/server';
import { UpstreamError, createDockerHubClient, type UpstreamErrorKind } from './dockerhub.server';
import { canFallBack, searchRepositories, suggestRepositories } from './search.server';

let calls: string[];

function client() {
  return createDockerHubClient({
    baseUrl: HUB,
    timeoutMs: 1000,
    budget: { tryAcquire: () => true, retryAfterSeconds: () => 0 },
    sleep: async () => {},
  });
}

beforeEach(() => {
  calls = [];
  server.use(...dockerHubHandlers);
  server.events.on('request:start', ({ request }) => {
    const url = new URL(request.url);
    calls.push(`${url.pathname}${url.search}`);
  });
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  server.events.removeAllListeners();
  vi.restoreAllMocks();
});

const nginxQuery: SearchQuery = { q: 'nginx', page: 1, pageSize: 25, sort: 'relevance' };
const popularQuery: SearchQuery = {
  q: '',
  page: 1,
  pageSize: 10,
  sort: 'pulls',
  badge: 'official',
};

/** v4 (search and suggestions) answers with the nginx fixture, mutated. */
function driftV4(mutate: (body: { results: Record<string, unknown>[] }) => void) {
  const body = cloneFixture(fixtures.searchV4Nginx) as unknown as {
    results: Record<string, unknown>[];
  };
  mutate(body);
  server.use(
    http.get(`${HUB}/api/search/v4`, () => HttpResponse.json(body)),
    http.get(`${HUB}/api/search/v4/suggestions`, () => HttpResponse.json(body)),
  );
}

const renameIds = (body: { results: Record<string, unknown>[] }) => {
  for (const result of body.results) {
    result.repo_id = result.id;
    delete result.id;
  }
};

async function rejection(
  promise: Promise<unknown>,
  kind: UpstreamErrorKind,
): Promise<UpstreamError> {
  const error = await promise.then(
    () => expect.fail('expected a rejection'),
    (reason: unknown) => reason,
  );
  expect(error).toBeInstanceOf(UpstreamError);
  expect((error as UpstreamError).kind).toBe(kind);
  return error as UpstreamError;
}

describe('searchRepositories', () => {
  it('popular 10 from v4', async () => {
    const result = await searchRepositories(client(), popularQuery);
    expect(result.source).toBe('v4');
    expect(result.page).toMatchObject({ total: 181, page: 1, pageSize: 10 });
    expect(result.page.items.map((item) => item.id).slice(0, 3)).toEqual([
      'library/nginx',
      'library/memcached',
      'library/busybox',
    ]);
    expect(calls).toEqual([
      '/api/search/v4?query=&from=0&size=10&sort=pull_count&order=desc&badges=official',
    ]);
  });

  it('a query from v4', async () => {
    const result = await searchRepositories(client(), nginxQuery);
    expect(result.source).toBe('v4');
    expect(result.page.items[0]?.id).toBe('library/nginx');
  });

  it('v4 drift: falls back to /v2/search/repositories and logs the failing path', async () => {
    driftV4(renameIds);
    const result = await searchRepositories(client(), { ...nginxQuery, page: 2 });
    expect(result.source).toBe('legacy');
    expect(result.page).toMatchObject({ total: 295800, page: 2, pageSize: 25 });
    expect(result.page.items[0]).toMatchObject({ id: 'library/nginx', badge: 'official' });
    expect(calls).toEqual([
      '/api/search/v4?query=nginx&from=25&size=25',
      '/v2/search/repositories/?query=nginx&page=2&page_size=25',
    ]);
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('$.results[0].id'));
  });

  it('v4 drift on popular (empty query, badge filter): no fallback, bad_payload with the path', async () => {
    driftV4((body) => {
      const second = body.results[1];
      if (second) second.star_count = 'lots';
    });
    const error = await rejection(searchRepositories(client(), popularQuery), 'bad_payload');
    expect(error.issuePath).toBe('$.results[1].star_count');
    expect(error.message).toContain('$.results[1].star_count');
    expect(error.message).not.toContain('lots');
    expect(calls).toHaveLength(1);
  });

  it('v4 non-JSON (Cloudflare HTML): no fallback', async () => {
    server.use(
      http.get(`${HUB}/api/search/v4`, () => HttpResponse.html('<html>Just a moment...</html>')),
    );
    const error = await rejection(searchRepositories(client(), nginxQuery), 'bad_payload');
    expect(error.issuePath).toBeUndefined();
    expect(calls.every((call) => call.startsWith('/api/search/v4'))).toBe(true);
  });

  it.each([
    [429, 'rate_limited'],
    [503, 'unavailable'],
    [404, 'not_found'],
  ] as const)('v4 %d: rethrown as %s, no fallback', async (status, kind) => {
    server.use(
      http.get(`${HUB}/api/search/v4`, () =>
        HttpResponse.json({ message: 'nope' }, { status, headers: { 'Retry-After': '60' } }),
      ),
    );
    await rejection(searchRepositories(client(), nginxQuery), kind);
    expect(calls.some((call) => call.startsWith('/v2/search'))).toBe(false);
  });

  it('both endpoints drifted: bad_payload from the legacy call', async () => {
    driftV4(renameIds);
    server.use(http.get(`${HUB}/v2/search/repositories/`, () => HttpResponse.json({ hits: [] })));
    const error = await rejection(searchRepositories(client(), nginxQuery), 'bad_payload');
    expect(error.endpoint).toBe('legacySearch');
    expect(error.issuePath).toBe('$.count');
  });
});

describe('suggestRepositories', () => {
  it('from v4', async () => {
    const result = await suggestRepositories(client(), 'ngi');
    expect(result).toMatchObject({ source: 'v4', page: { page: 1, pageSize: 10 } });
    expect(result.page.items[0]?.id).toBe('library/nginx');
  });

  it('falls back on v4 drift', async () => {
    driftV4(renameIds);
    const result = await suggestRepositories(client(), 'nginx');
    expect(result.source).toBe('legacy');
    expect(calls[1]).toBe('/v2/search/repositories/?query=nginx&page=1&page_size=10');
  });
});

describe('canFallBack', () => {
  it.each([
    [{ q: 'nginx' }, true],
    [{ q: '   ' }, false],
    [{ q: '' }, false],
    [{ q: 'nginx', badge: 'official' as const }, false],
  ])('%j → %j', (query, expected) => {
    expect(canFallBack(query)).toBe(expected);
  });
});
