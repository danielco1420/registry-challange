/**
 * Search results page (T23): the loader against the real cache, budget and
 * upstream client (MSW fixtures), and the page's states and URL handling in a
 * memory router (filters, pagination, Back/Forward, empty, degraded, legacy).
 */
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import type * as React from 'react';
import {
  createMemoryRouter,
  RouterProvider,
  useLoaderData,
  type LoaderFunctionArgs,
} from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import '~/i18n/i18next';

import type { RepoSummary, SearchPage } from '~/lib/dto';
import { parseSearchUrl, type ParsedSearchUrl, type SearchPageData } from '~/lib/search-query';
import { cache } from '~/server/cache.server';

import { HUB, dockerHubHandlers } from '../../test/msw/dockerhub';
import { server } from '../../test/msw/server';
import { loader as apiSearchLoader } from './api.search';
import SearchResults, { loader, meta } from './search';

// ---------------------------------------------------------------------------
// Loader
// ---------------------------------------------------------------------------

/** The query strings of every Docker Hub search request, in order. */
let upstream: URLSearchParams[];

function load(search: string) {
  const request = new Request(`http://localhost/search${search}`);
  return loader({ request, params: {}, context: {} } as unknown as Parameters<typeof loader>[0]);
}

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
  upstream = [];
  server.use(...dockerHubHandlers);
  server.events.on('request:start', ({ request }) => {
    const url = new URL(request.url);
    if (url.pathname === '/api/search/v4') upstream.push(url.searchParams);
  });
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  server.events.removeAllListeners();
  vi.restoreAllMocks();
});

describe('search loader', () => {
  it('defaults to relevance, no badge, page 1, 25 per page', async () => {
    const data = await load('?q=nginx');

    expect(data).toMatchObject({ q: 'nginx', sort: 'relevance', page: 1, degraded: false });
    expect(data.badge).toBeUndefined();
    expect(data.results.source).toBe('v4');
    expect(data.results.total).toBe(295_811);
    expect(data.results.items.map((repo) => repo.id)).toContain('library/nginx');

    expect(upstream).toHaveLength(1);
    expect(Object.fromEntries(upstream[0]!)).toEqual({ query: 'nginx', from: '0', size: '25' });
  });

  it('forwards sort, badge and page upstream', async () => {
    const data = await load('?q=nginx&sort=stars&badge=official&page=3');

    expect(data).toMatchObject({ q: 'nginx', sort: 'stars', badge: 'official', page: 3 });
    expect(Object.fromEntries(upstream[0]!)).toEqual({
      query: 'nginx',
      from: '50',
      size: '25',
      sort: 'star_count',
      order: 'desc',
      badges: 'official',
    });
  });

  it('falls back to the defaults for invalid params instead of failing with a 400', async () => {
    const data = await load('?q=nginx&sort=bogus&badge=hardened&page=41&pageSize=100');

    expect(data).toMatchObject({ q: 'nginx', sort: 'relevance', page: 1 });
    expect(data.badge).toBeUndefined();
    expect(Object.fromEntries(upstream[0]!)).toEqual({ query: 'nginx', from: '0', size: '25' });
  });

  it('cuts an over-long query instead of failing', async () => {
    const data = await load(`?q=${'a'.repeat(300)}`);
    expect(data.q).toBe('a'.repeat(100));
    expect(upstream[0]?.get('query')).toBe('a'.repeat(100));
  });

  it('browses every image when q is missing', async () => {
    const data = await load('');
    expect(data.q).toBe('');
    expect(upstream[0]?.get('query')).toBe('');
  });

  it('shares its cache entry with GET /api/search', async () => {
    await load('?q=nginx&sort=pulls');
    const response = await apiSearchLoader({
      request: new Request('http://localhost/api/search?q=nginx&sort=pulls'),
    } as unknown as Parameters<typeof apiSearchLoader>[0]);

    expect(response.status).toBe(200);
    expect(response.headers.get('X-Cache')).toBe('HIT');
    expect(upstream).toHaveLength(1);
  });

  it('throws the mapped page error when Docker Hub is down and nothing is cached', async () => {
    upstreamDown();

    try {
      await load('?q=nginx');
      expect.unreachable('loader should have thrown');
    } catch (error) {
      const { data, init } = error as { data: { kind: string }; init: { status: number } };
      expect(init.status).toBe(503);
      expect(data.kind).toBe('unavailable');
    }
  });
});

describe('meta', () => {
  const titleOf = (data: Partial<SearchPageData> | undefined) =>
    meta({ data } as unknown as Parameters<typeof meta>[0]);

  it('names the query in the title', () => {
    expect(titleOf({ q: 'nginx' })).toEqual([
      { title: "“nginx” search results | Danny's Dockers" },
    ]);
  });

  it('has a generic title without a query, or without data', () => {
    expect(titleOf({ q: '' })).toEqual([{ title: "Search images | Danny's Dockers" }]);
    expect(titleOf(undefined)).toEqual([{ title: "Search images | Danny's Dockers" }]);
  });
});

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

const repo = (n: number): RepoSummary => ({
  id: `acme/image-${n}`,
  namespace: 'acme',
  name: `image-${n}`,
  displayName: `acme/image-${n}`,
  owner: 'Acme',
  description: `Image number ${n}.`,
  badge: 'none',
  pulls: 1000,
  pullsLabel: '1K',
  stars: 1,
  updatedAt: '',
  archs: [],
  archived: false,
});

/** Page `page` of `total` results, 25 per page, as Docker Hub would page them. */
function resultsOf(page: number, total: number, source: SearchPage['source'] = 'v4'): SearchPage {
  const start = (page - 1) * 25;
  const count = Math.max(0, Math.min(25, total - start));
  return {
    items: Array.from({ length: count }, (_, i) => repo(start + i + 1)),
    total,
    page,
    pageSize: 25,
    source,
  };
}

interface Answer {
  results: SearchPage;
  degraded?: boolean;
}

/** A route module's default export, fed its loader data as `useLoaderData` gives it. */
function withLoaderData<T>(Component: unknown) {
  const Inner = Component as React.ComponentType<{ loaderData: T }>;
  return function Route() {
    return <Inner loaderData={useLoaderData() as T} />;
  };
}

/** `/search` with a stub loader that reads the URL as the real one does and answers `answer(url)`. */
function renderSearch(path: string, answer: (url: ParsedSearchUrl) => Answer) {
  const requests: ParsedSearchUrl[] = [];
  const searchLoader = ({ request }: LoaderFunctionArgs): SearchPageData => {
    const url = parseSearchUrl(new URL(request.url).searchParams);
    requests.push(url);
    const { results, degraded = false } = answer(url);
    return { ...url, results, degraded };
  };
  const router = createMemoryRouter(
    [
      { path: '/', Component: () => <p>Explore</p> },
      {
        path: '/search',
        loader: searchLoader,
        Component: withLoaderData<SearchPageData>(SearchResults),
      },
    ],
    { initialEntries: [path] },
  );
  render(<RouterProvider router={router} />);
  return { router, requests };
}

const many = (url: ParsedSearchUrl): Answer => ({ results: resultsOf(url.page, 295_913) });
const pagination = () => screen.getByRole('navigation', { name: 'Pages of results' });
const currentPage = () =>
  within(pagination())
    .getAllByRole('link')
    .find((link) => link.getAttribute('aria-current') === 'page');
const group = (name: string) => screen.getByRole('group', { name });

describe('SearchResults', () => {
  it('shows the query, the total and a card per result', async () => {
    renderSearch('/search?q=nginx', many);

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Results for “nginx”' }),
    ).toBeInTheDocument();
    expect(screen.getByText('Showing 1–25 of 295,913 results')).toBeInTheDocument();
    expect(screen.getAllByRole('heading', { level: 2 })).toHaveLength(25);
    expect(screen.getByRole('link', { name: 'acme/image-1' })).toHaveAttribute(
      'href',
      '/r/acme/image-1',
    );
  });

  it('shows the plain count when everything fits on one page, and no pagination', async () => {
    renderSearch('/search?q=nginx', () => ({ results: resultsOf(1, 1) }));

    expect(await screen.findByText('1 result')).toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: 'Pages of results' })).not.toBeInTheDocument();
  });

  it('numbers the pages up to the anonymous cap and says why it stops', async () => {
    renderSearch('/search?q=nginx&page=6', many);

    await screen.findByText('Showing 126–150 of 295,913 results');
    const links = within(pagination()).getAllByRole('link');
    expect(links.map((link) => link.textContent)).toEqual([
      'Previous',
      '1',
      '5',
      '6',
      '7',
      '40',
      'Next',
    ]);
    expect(currentPage()).toHaveAccessibleName('Page 6');
    expect(within(pagination()).getByRole('link', { name: 'Page 40' })).toHaveAttribute(
      'href',
      '/search?q=nginx&page=40',
    );
    expect(within(pagination()).getByRole('link', { name: 'Previous' })).toHaveAttribute(
      'href',
      '/search?q=nginx&page=5',
    );
    expect(screen.getByText(/lists only the first 1,000 results without sign-in/)).toBeVisible();
  });

  it('disables Previous on the first page and Next on the last', async () => {
    const { router } = renderSearch('/search?q=nginx&sort=pulls', () => ({
      results: resultsOf(1, 60),
    }));

    await screen.findByText('Showing 1–25 of 60 results');
    expect(within(pagination()).queryByRole('link', { name: 'Previous' })).toBeNull();
    expect(within(pagination()).getByText('Previous')).toHaveAttribute('aria-disabled', 'true');

    await act(() => router.navigate('/search?q=nginx&sort=pulls&page=3'));
    expect(within(pagination()).queryByRole('link', { name: 'Next' })).toBeNull();
    expect(within(pagination()).getByText('Next')).toHaveAttribute('aria-disabled', 'true');
  });

  it('keeps the filters on page links, and drops the page on filter links', async () => {
    renderSearch('/search?q=nginx&sort=stars&badge=official&page=2', many);
    await screen.findByText('Showing 26–50 of 295,913 results');

    expect(within(pagination()).getByRole('link', { name: 'Page 3' })).toHaveAttribute(
      'href',
      '/search?q=nginx&sort=stars&badge=official&page=3',
    );

    const sort = group('Sort by');
    expect(within(sort).getByRole('link', { name: 'Most stars' })).toHaveAttribute(
      'aria-current',
      'true',
    );
    expect(within(sort).getByRole('link', { name: 'Best match' })).toHaveAttribute(
      'href',
      '/search?q=nginx&badge=official',
    );
    expect(within(sort).getByRole('link', { name: 'Recently updated' })).toHaveAttribute(
      'href',
      '/search?q=nginx&sort=updated&badge=official',
    );

    const badge = group('Show');
    expect(within(badge).getByRole('link', { name: 'Official Images' })).toHaveAttribute(
      'aria-current',
      'true',
    );
    expect(within(badge).getByRole('link', { name: 'All images' })).toHaveAttribute(
      'href',
      '/search?q=nginx&sort=stars',
    );
    expect(within(badge).getByRole('link', { name: 'Verified Publishers' })).toHaveAttribute(
      'href',
      '/search?q=nginx&sort=stars&badge=verified_publisher',
    );
  });

  it('changing a filter loads page 1', async () => {
    const { router, requests } = renderSearch('/search?q=nginx&page=4', many);
    await screen.findByText('Showing 76–100 of 295,913 results');

    fireEvent.click(within(group('Sort by')).getByRole('link', { name: 'Most pulls' }));
    await screen.findByText('Showing 1–25 of 295,913 results');
    expect(router.state.location.search).toBe('?q=nginx&sort=pulls');
    expect(requests.at(-1)).toMatchObject({ sort: 'pulls', page: 1 });

    fireEvent.click(within(pagination()).getByRole('link', { name: 'Page 2' }));
    await screen.findByText('Showing 26–50 of 295,913 results');

    fireEvent.click(within(group('Show')).getByRole('link', { name: 'Sponsored OSS' }));
    await screen.findByText('Showing 1–25 of 295,913 results');
    expect(router.state.location.search).toBe('?q=nginx&sort=pulls&badge=open_source');
    expect(requests.at(-1)).toMatchObject({ badge: 'open_source', page: 1 });
  });

  it('follows Back and Forward through pages and filters', async () => {
    const { router } = renderSearch('/search?q=nginx', many);
    await screen.findByText('Showing 1–25 of 295,913 results');

    fireEvent.click(within(pagination()).getByRole('link', { name: 'Next' }));
    await screen.findByText('Showing 26–50 of 295,913 results');
    fireEvent.click(within(group('Sort by')).getByRole('link', { name: 'Most stars' }));
    await screen.findByText('Showing 1–25 of 295,913 results');
    expect(within(group('Sort by')).getByRole('link', { name: 'Most stars' })).toHaveAttribute(
      'aria-current',
      'true',
    );

    await act(() => router.navigate(-1));
    await screen.findByText('Showing 26–50 of 295,913 results');
    expect(currentPage()).toHaveAccessibleName('Page 2');
    expect(within(group('Sort by')).getByRole('link', { name: 'Best match' })).toHaveAttribute(
      'aria-current',
      'true',
    );

    await act(() => router.navigate(-1));
    await screen.findByText('Showing 1–25 of 295,913 results');
    expect(router.state.location.search).toBe('?q=nginx');

    await act(() => router.navigate(1));
    await screen.findByText('Showing 26–50 of 295,913 results');
    expect(router.state.location.search).toBe('?q=nginx&page=2');
  });

  it('reads an invalid URL with the defaults', async () => {
    renderSearch('/search?q=nginx&sort=nope&badge=nope&page=nope', many);

    await screen.findByText('Showing 1–25 of 295,913 results');
    expect(within(group('Sort by')).getByRole('link', { name: 'Best match' })).toHaveAttribute(
      'aria-current',
      'true',
    );
    expect(within(group('Show')).getByRole('link', { name: 'All images' })).toHaveAttribute(
      'aria-current',
      'true',
    );
    expect(currentPage()).toHaveAccessibleName('Page 1');
  });

  it('offers to clear the filters when a filtered search finds nothing', async () => {
    renderSearch('/search?q=zzz&sort=stars&badge=official', () => ({
      results: resultsOf(1, 0),
    }));

    expect(
      await screen.findByRole('heading', { level: 2, name: 'No results for “zzz”' }),
    ).toBeInTheDocument();
    expect(screen.getByText(/or clear the filters/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Clear filters' })).toHaveAttribute(
      'href',
      '/search?q=zzz',
    );
    expect(screen.queryByRole('navigation', { name: 'Pages of results' })).not.toBeInTheDocument();
  });

  it('clearing the filters searches again with the query alone', async () => {
    const { router } = renderSearch('/search?q=zzz&badge=official', (url) => ({
      results: url.badge ? resultsOf(1, 0) : resultsOf(1, 3),
    }));

    fireEvent.click(await screen.findByRole('link', { name: 'Clear filters' }));
    expect(await screen.findByText('3 results')).toBeInTheDocument();
    expect(router.state.location.search).toBe('?q=zzz');
  });

  it('points back to Explore when an unfiltered search finds nothing', async () => {
    renderSearch('/search?q=zzz', () => ({ results: resultsOf(1, 0) }));

    expect(await screen.findByText('No results for “zzz”')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Clear filters' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back to Explore' })).toHaveAttribute('href', '/');
  });

  it('says when a page is past the last one, and links to page 1', async () => {
    renderSearch('/search?q=nginx&sort=pulls&page=9', () => ({ results: resultsOf(9, 30) }));

    expect(await screen.findByText('No results on this page')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Go to page 1' })).toHaveAttribute(
      'href',
      '/search?q=nginx&sort=pulls',
    );
  });

  it('shows the degraded banner over stale results', async () => {
    renderSearch('/search?q=nginx', (url) => ({ results: resultsOf(url.page, 3), degraded: true }));

    expect(await screen.findByText('Showing saved data.')).toBeInTheDocument();
    expect(screen.getByText('3 results')).toBeInTheDocument();
  });

  it('says when the results come from the legacy search', async () => {
    renderSearch('/search?q=nginx&sort=stars', () => ({ results: resultsOf(1, 3, 'legacy') }));

    expect(await screen.findByText('Showing basic results.')).toBeInTheDocument();
    expect(screen.getByText(/in best-match order/)).toBeInTheDocument();
  });

  it('has a generic heading without a query', async () => {
    renderSearch('/search', () => ({ results: resultsOf(1, 3) }));
    expect(
      await screen.findByRole('heading', { level: 1, name: 'All images' }),
    ).toBeInTheDocument();
  });
});
