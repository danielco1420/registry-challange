/**
 * Explore page (T20, docs/API.md "Popular 10"): the loader against the real
 * cache, budget and upstream client (MSW fixtures), and the component's
 * states (search box, grid, degraded banner, empty, retry).
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import type * as React from 'react';
import { createRoutesStub } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import '~/i18n/i18next';

import type { SearchPage } from '~/lib/dto';
import { cache } from '~/server/cache.server';
import type { ExplorePageData } from '~/server/popular.server';

import { HUB, dockerHubHandlers } from '../../test/msw/dockerhub';
import { server } from '../../test/msw/server';
import { loader as popularApiLoader } from './api.popular';
import Home, { loader, meta } from './home';

/** Every Docker Hub request answers 503 with a `Retry-After` too long to retry in-request. */
function upstreamDown() {
  server.use(
    http.all(`${HUB}/*`, () =>
      HttpResponse.json({ message: 'down' }, { status: 503, headers: { 'Retry-After': '60' } }),
    ),
  );
}

function request() {
  return new Request('http://localhost/');
}

/** Lets a background refresh (fetch, retry, body read) settle, like upstream.server.test.ts. */
async function flush() {
  for (let i = 0; i < 10; i += 1) await new Promise<void>((resolve) => setImmediate(resolve));
}

/** The shape thrown by `toPageErrorResponse` / `data()` outside a real router (a raw loader call). */
function pageErrorOf(error: unknown): { data: { kind: string }; init: { status: number } } {
  return error as { data: { kind: string }; init: { status: number } };
}

beforeEach(() => {
  cache.clear();
  server.use(...dockerHubHandlers);
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('home loader', () => {
  it('returns the 10 most popular official images, not degraded', async () => {
    const data = await loader({ request: request() } as Parameters<typeof loader>[0]);
    expect(data.degraded).toBe(false);
    expect(data.popular.items[0]).toMatchObject({ id: 'library/nginx', badge: 'official' });
    expect(data.popular.items.length).toBeLessThanOrEqual(10);
  });

  it('serves a stale copy and flags it as degraded once a background refresh has failed', async () => {
    await loader({ request: request() } as Parameters<typeof loader>[0]);
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.now() + 2 * 600_000);
    upstreamDown();

    // The first stale read isn't degraded yet: its background refresh is still running.
    const first = await loader({ request: request() } as Parameters<typeof loader>[0]);
    expect(first.degraded).toBe(false);
    await flush();

    const second = await loader({ request: request() } as Parameters<typeof loader>[0]);
    expect(second.degraded).toBe(true);
    expect(second.popular.items[0]?.id).toBe('library/nginx');
  });

  it('throws the mapped page error when Docker Hub is down and nothing is cached', async () => {
    upstreamDown();

    try {
      await loader({ request: request() } as Parameters<typeof loader>[0]);
      expect.unreachable('loader should have thrown');
    } catch (error) {
      const { data, init } = pageErrorOf(error);
      expect(init.status).toBe(503);
      expect(data.kind).toBe('unavailable');
    }
  });

  it('shares its cache entry with GET /api/popular', async () => {
    await loader({ request: request() } as Parameters<typeof loader>[0]);
    upstreamDown();

    const response = await popularApiLoader({
      request: new Request('http://localhost/api/popular'),
    } as Parameters<typeof popularApiLoader>[0]);
    expect(response.status).toBe(200);
    expect(response.headers.get('X-Cache')).toBe('HIT');
    const body = (await response.json()) as SearchPage;
    expect(body.items[0]?.id).toBe('library/nginx');
  });
});

describe('meta', () => {
  it('sets the document title and a description', () => {
    const result = meta({} as Parameters<typeof meta>[0]);
    expect(result).toEqual([
      { title: "Danny's Dockers" },
      { name: 'description', content: expect.any(String) },
    ]);
  });
});

/** `Home` with a stubbed loader; `load` may answer differently on each call (revalidation). */
function renderHome(load: ExplorePageData | (() => ExplorePageData | Promise<ExplorePageData>)) {
  const Page = Home as unknown as React.ComponentType;
  const Stub = createRoutesStub([
    { path: '/', Component: Page, loader: typeof load === 'function' ? load : () => load },
  ]);
  return render(<Stub initialEntries={['/']} />);
}

const POPULAR: SearchPage = {
  source: 'v4',
  total: 2,
  page: 1,
  pageSize: 10,
  items: [
    {
      id: 'library/nginx',
      namespace: 'library',
      name: 'nginx',
      displayName: 'nginx',
      owner: 'NGINX Inc.',
      description: 'Official build of Nginx.',
      badge: 'official',
      pulls: 1_000_000_000,
      pullsLabel: '1B+',
      stars: 100,
      updatedAt: '',
      archs: [],
      archived: false,
    },
    {
      id: 'library/redis',
      namespace: 'library',
      name: 'redis',
      displayName: 'redis',
      owner: 'Redis',
      description: 'Official build of Redis.',
      badge: 'official',
      pulls: 500_000_000,
      pullsLabel: '500M+',
      stars: 50,
      updatedAt: '',
      archs: [],
      archived: false,
    },
  ],
};

describe('Home', () => {
  it('renders the page heading', async () => {
    renderHome({ popular: POPULAR, degraded: false });
    expect(
      await screen.findByRole('heading', { level: 1, name: "Danny's Dockers" }),
    ).toBeInTheDocument();
  });

  it('has the search box', async () => {
    renderHome({ popular: POPULAR, degraded: false });
    const search = await screen.findByRole('search', { name: 'Search images' });
    expect(search).toHaveAttribute('action', '/search');
  });

  it('renders a card grid for the popular images', async () => {
    renderHome({ popular: POPULAR, degraded: false });

    const section = await screen.findByRole('region', { name: 'Popular official images' });
    expect(screen.getByRole('link', { name: 'nginx' })).toHaveAttribute('href', '/_/nginx');
    expect(screen.getByRole('link', { name: 'redis' })).toHaveAttribute('href', '/_/redis');
    expect(screen.getByRole('heading', { level: 3, name: 'nginx' })).toBeInTheDocument();
    expect(section).not.toHaveAttribute('aria-busy');
    expect(screen.queryByText('Loading…')).not.toBeInTheDocument();
  });

  it('shows the degraded banner when the loader flagged stale data', async () => {
    renderHome({ popular: POPULAR, degraded: true });

    expect(await screen.findByText('Showing saved data.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'nginx' })).toBeInTheDocument();
  });

  it('shows the empty state with a retry action when there are no popular images', async () => {
    renderHome({ popular: { ...POPULAR, items: [], total: 0 }, degraded: false });

    expect(
      await screen.findByRole('heading', { level: 3, name: 'No popular images right now' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });

  it('shows the loading state while "Try again" re-runs the loader, then the new data', async () => {
    let resolveRetry: (data: ExplorePageData) => void = () => {};
    const load = vi
      .fn<() => ExplorePageData | Promise<ExplorePageData>>()
      .mockReturnValueOnce({ popular: { ...POPULAR, items: [], total: 0 }, degraded: false })
      .mockReturnValueOnce(
        new Promise<ExplorePageData>((resolve) => {
          resolveRetry = resolve;
        }),
      );
    renderHome(load);

    fireEvent.click(await screen.findByRole('button', { name: 'Try again' }));

    expect(await screen.findByText('Loading…')).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Popular official images' })).toHaveAttribute(
      'aria-busy',
      'true',
    );
    expect(screen.queryByText('No popular images right now')).not.toBeInTheDocument();

    resolveRetry({ popular: POPULAR, degraded: false });
    expect(await screen.findByRole('link', { name: 'nginx' })).toBeInTheDocument();
    expect(screen.queryByText('Loading…')).not.toBeInTheDocument();
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('re-runs the loader from the degraded banner and drops it once the data is fresh', async () => {
    const load = vi
      .fn<() => ExplorePageData>()
      .mockReturnValueOnce({ popular: POPULAR, degraded: true })
      .mockReturnValueOnce({ popular: POPULAR, degraded: false });
    renderHome(load);

    expect(await screen.findByText('Showing saved data.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));

    await screen.findByRole('link', { name: 'nginx' });
    await vi.waitFor(() => expect(screen.queryByText('Showing saved data.')).toBeNull());
    expect(load).toHaveBeenCalledTimes(2);
  });
});
