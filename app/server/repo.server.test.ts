/**
 * The repository page's layout loader (`loadRepoPage`, T24): the
 * `/r/library/{repo}` redirect, not-found and unavailable states, and the
 * cache entry it shares with `GET /api/repos/:ns/:repo`. Upstream calls go to
 * MSW serving the recorded Docker Hub fixtures.
 */
import { http, HttpResponse } from 'msw';
import {
  createStaticHandler,
  isRouteErrorResponse,
  type LoaderFunction,
  type RouteObject,
} from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { PageErrorBody } from '../lib/route-error';
import { loader as apiRepoLoader } from '../routes/api.repos.$ns.$repo';
import { HUB, dockerHubHandlers } from '../../test/msw/dockerhub';
import { server } from '../../test/msw/server';
import { cache } from './cache.server';
import { canonicalRepoUrl, loadRepoPage, type RepoPageData } from './repo.server';

/** Upstream paths requested during the test. */
let calls: string[];

beforeEach(() => {
  cache.clear();
  calls = [];
  server.use(...dockerHubHandlers);
  server.events.on('request:start', ({ request }) => {
    calls.push(new URL(request.url).pathname);
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

/** The same paths and loader as `app/routes.ts`, so URL matching is the router's own. */
const pageLoader: LoaderFunction = ({ request, params }) => loadRepoPage({ request, params });
const routes: RouteObject[] = [
  {
    id: 'repo',
    path: 'r/:ns/:repo',
    loader: pageLoader,
    children: [
      { id: 'repo-overview', index: true },
      { id: 'repo-tags', path: 'tags' },
    ],
  },
  {
    id: 'official-repo',
    path: '_/:repo',
    loader: pageLoader,
    children: [
      { id: 'official-repo-overview', index: true },
      { id: 'official-repo-tags', path: 'tags' },
    ],
  },
];
const handler = createStaticHandler(routes);

/** Runs the matched loaders for `path` like a document request. */
async function visit(path: string) {
  return handler.query(new Request(`http://localhost${path}`));
}

/** The loader's result, or what it threw. */
async function load(params: { ns?: string; repo?: string }, path: string) {
  try {
    return {
      data: await loadRepoPage({ request: new Request(`http://localhost${path}`), params }),
    };
  } catch (thrown) {
    return { thrown };
  }
}

/** A thrown `data(PageErrorBody, init)` (see `pageError.server.ts`). */
interface ThrownPageError {
  data: PageErrorBody;
  init: { status: number; headers: Headers };
}

function expectPageError(
  thrown: unknown,
  status: number,
  kind: PageErrorBody['kind'],
): ThrownPageError {
  const error = thrown as ThrownPageError;
  expect(error?.init?.status).toBe(status);
  expect(error.data.kind).toBe(kind);
  return error;
}

function upstreamDown() {
  server.use(
    http.all(`${HUB}/*`, () =>
      HttpResponse.json({ message: 'down' }, { status: 503, headers: { 'Retry-After': '60' } }),
    ),
  );
}

describe('/r/library/:repo redirect', () => {
  it.each([
    ['/r/library/nginx', '/_/nginx'],
    ['/r/library/nginx/', '/_/nginx'],
    ['/r/library/nginx/tags', '/_/nginx/tags'],
    ['/r/library/nginx/tags?name=alpine&ordering=name', '/_/nginx/tags?name=alpine&ordering=name'],
    ['/r/library/nginx?x=1', '/_/nginx?x=1'],
  ])('%s → 301 %s, without an upstream call', async (path, location) => {
    const result = await visit(path);
    expect(result).toBeInstanceOf(Response);
    const res = result as Response;
    expect(res.status).toBe(301);
    expect(res.headers.get('Location')).toBe(location);
    expect(calls).toEqual([]);
  });

  it.each(['/_/nginx', '/_/nginx/tags', '/r/fluent/fluent-bit', '/r/fluent/fluent-bit/tags'])(
    "doesn't redirect the canonical URL %s",
    async (path) => {
      const result = await visit(path);
      expect(result).not.toBeInstanceOf(Response);
    },
  );

  it('canonicalRepoUrl: null for anything but /r/library/…', () => {
    const request = (path: string) => new Request(`http://localhost${path}`);
    expect(canonicalRepoUrl(request('/_/nginx'), { ns: 'library', repo: 'nginx' })).toBeNull();
    expect(
      canonicalRepoUrl(request('/r/fluent/fluent-bit'), { ns: 'fluent', repo: 'fluent-bit' }),
    ).toBeNull();
    expect(canonicalRepoUrl(request('/r/library/nginx'), { ns: 'library', repo: 'nginx' })).toBe(
      '/_/nginx',
    );
  });

  it("validates before redirecting: an invalid name is 'repository not found'", async () => {
    const { thrown } = await load({ ns: 'library', repo: 'NGINX' }, '/r/library/NGINX');
    expectPageError(thrown, 404, 'repo_not_found');
    expect(calls).toEqual([]);
  });
});

describe('loadRepoPage', () => {
  it('/_/:repo loads the official repository from `library`', async () => {
    const { data } = await load({ repo: 'nginx' }, '/_/nginx');
    expect(data).toMatchObject<Partial<RepoPageData>>({ degraded: false });
    expect(data?.repo).toMatchObject({ id: 'library/nginx', badge: 'official' });
    expect(data?.repo.fullDescriptionMd).toContain('# Quick reference');
    expect(calls).toEqual(['/v2/namespaces/library/repositories/nginx']);
  });

  it('/r/:ns/:repo loads a community repository', async () => {
    const { data } = await load({ ns: 'fluent', repo: 'fluent-bit' }, '/r/fluent/fluent-bit');
    expect(data?.repo).toMatchObject({ id: 'fluent/fluent-bit', namespace: 'fluent' });
  });

  it('an archived repository loads with `archived: true`', async () => {
    const { data } = await load({ ns: 'kernel528', repo: 'archived' }, '/r/kernel528/archived');
    expect(data?.repo.archived).toBe(true);
  });

  it('shares its cache entry with GET /api/repos/:ns/:repo: one upstream call', async () => {
    await load({ repo: 'nginx' }, '/_/nginx');
    const res = (await apiRepoLoader({
      request: new Request('http://localhost/api/repos/library/nginx'),
      params: { ns: 'library', repo: 'nginx' },
    } as Parameters<typeof apiRepoLoader>[0])) as Response;
    expect(res.status).toBe(200);
    expect(res.headers.get('X-Cache')).toBe('HIT');
    expect(calls).toEqual(['/v2/namespaces/library/repositories/nginx']);
  });

  it('a missing repository: 404 "repository not found", cached', async () => {
    const first = await load({ ns: 'library', repo: 'does-not-exist' }, '/_/does-not-exist');
    expectPageError(first.thrown, 404, 'repo_not_found');
    const second = await load({ ns: 'library', repo: 'does-not-exist' }, '/_/does-not-exist');
    expectPageError(second.thrown, 404, 'repo_not_found');
    expect(calls).toEqual(['/v2/namespaces/library/repositories/does-not-exist']);
  });

  it.each([
    [{ ns: 'Fluent', repo: 'fluent-bit' }],
    [{ ns: 'fluent', repo: 'fluent-bit..x' }],
    [{ ns: 'fluent', repo: '../../v2/users' }],
    [{ ns: 'fluent', repo: 'a'.repeat(256) }],
    [{ ns: 'fluent' }],
  ])('invalid params %j: 404 "repository not found", no upstream call', async (params) => {
    const { thrown } = await load(params, '/r/x/y');
    expectPageError(thrown, 404, 'repo_not_found');
    expect(calls).toEqual([]);
  });

  it('Docker Hub down with nothing cached: 503 "unavailable" with Retry-After', async () => {
    upstreamDown();
    const { thrown } = await load({ repo: 'nginx' }, '/_/nginx');
    const error = expectPageError(thrown, 503, 'unavailable');
    expect(error.data.retryAfterSeconds).toBe(60);
    expect(error.init.headers.get('Retry-After')).toBe('60');
  });

  it('the document gets the status of a page error', async () => {
    const result = await visit('/_/does-not-exist');
    expect(result).not.toBeInstanceOf(Response);
    if (result instanceof Response) return;
    expect(result.statusCode).toBe(404);
    const error = result.errors?.['official-repo'];
    expect(isRouteErrorResponse(error) && (error.data as PageErrorBody).kind).toBe(
      'repo_not_found',
    );
  });

  it('Docker Hub down with a stale copy: the copy, flagged `degraded`', async () => {
    await load({ repo: 'nginx' }, '/_/nginx');
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.now() + 2 * 300_000);
    upstreamDown();

    // The first stale read starts a background refresh; once it has failed, reads are degraded.
    const first = await load({ repo: 'nginx' }, '/_/nginx');
    expect(first.data?.repo.id).toBe('library/nginx');
    await vi.waitFor(async () => {
      const { data } = await load({ repo: 'nginx' }, '/_/nginx');
      expect(data).toMatchObject({ degraded: true, repo: { id: 'library/nginx' } });
    });
  });
});
