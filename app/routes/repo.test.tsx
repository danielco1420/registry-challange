import { act, fireEvent, render, screen, within } from '@testing-library/react';
import type * as React from 'react';
import { createMemoryRouter, createRoutesStub, RouterProvider, useLoaderData } from 'react-router';
import { describe, expect, it } from 'vitest';

import '~/i18n/i18next';

import type { RepoDetails } from '~/lib/dto';
import type { TagsTabData } from '~/lib/tags-query';
import type { RepoPageData } from '~/server/repo.server';

import RepoPage, { meta, shouldRevalidate } from './repo';
import RepoOverview from './repo._index';
import RepoTags from './repo.tags';

const FLUENT_BIT: RepoDetails = {
  id: 'fluent/fluent-bit',
  namespace: 'fluent',
  name: 'fluent-bit',
  displayName: 'fluent/fluent-bit',
  owner: 'fluent',
  description: 'Fast and lightweight logs and metrics processor.',
  logoUrl: 'https://d1q6f0aelx0por.cloudfront.net/product-logos/fluent-bit.png',
  badge: 'open_source',
  pulls: 1_234_567_890,
  pullsLabel: '1.2B',
  stars: 2100,
  updatedAt: '2026-10-30T12:00:00Z',
  archs: [],
  archived: false,
  fullDescriptionMd:
    '# Fluent Bit\n\nSee [the docs](https://docs.fluentbit.io).\n\n<script>alert(1)</script>',
  registeredAt: '2017-01-01T00:00:00Z',
  categories: [],
};

const NGINX: RepoDetails = {
  ...FLUENT_BIT,
  id: 'library/nginx',
  namespace: 'library',
  name: 'nginx',
  displayName: 'nginx',
  owner: 'library',
  description: 'Official build of Nginx.',
  logoUrl: 'https://d1q6f0aelx0por.cloudfront.net/product-logos/nginx.png',
  badge: 'official',
  fullDescriptionMd: '# Quick reference',
};

/** The Tags tab's loader data for a repository without tags (the tab itself is tested in repo.tags.test.tsx). */
const NO_TAGS: TagsTabData = {
  ordering: 'last_updated',
  name: '',
  page: 1,
  result: { ok: true, degraded: false, tags: { items: [], total: 0, page: 1, pageSize: 50 } },
};

/** The Tags tab, fed its loader data as `useLoaderData` gives it (for `createMemoryRouter`). */
function TagsWithData() {
  const Tags = RepoTags as unknown as React.ComponentType<{ loaderData: TagsTabData }>;
  return <Tags loaderData={useLoaderData<TagsTabData>()} />;
}

/** The layout and its tabs as `app/routes.ts` wires them, with stubbed loaders. */
function renderPage(path: string, data: RepoPageData) {
  const Page = RepoPage as unknown as React.ComponentType;
  const children = [
    { index: true, Component: RepoOverview },
    { path: 'tags', loader: () => NO_TAGS, Component: RepoTags as unknown as React.ComponentType },
  ];
  const Stub = createRoutesStub([
    { path: '/r/:ns/:repo', loader: () => data, Component: Page, children },
    { path: '/_/:repo', loader: () => data, Component: Page, children },
    { path: '/elsewhere', Component: () => <p>Elsewhere</p> },
  ]);
  return render(<Stub initialEntries={[path]} />);
}

describe('repository page', () => {
  it('shows the header: name, owner, description, badge and stats', async () => {
    renderPage('/r/fluent/fluent-bit', { repo: FLUENT_BIT, degraded: false });

    const heading = await screen.findByRole('heading', { level: 1, name: 'fluent/fluent-bit' });
    const header = heading.closest('header');
    expect(header).not.toBeNull();
    const scope = within(header!);
    expect(scope.getByText('by fluent')).toBeInTheDocument();
    expect(scope.getByText(FLUENT_BIT.description)).toBeInTheDocument();
    expect(scope.getByText('Sponsored OSS')).toBeInTheDocument();
    expect(scope.getByText('1.2B')).toBeInTheDocument();
    expect(scope.getByText('2.1K')).toBeInTheDocument();
    const updated = header!.querySelector('time');
    expect(updated).toHaveAttribute('dateTime', FLUENT_BIT.updatedAt);
    expect(updated?.getAttribute('title')).toMatch(/2026/);
  });

  it('has Overview | Tags tabs, with the current one marked', async () => {
    renderPage('/_/nginx', { repo: NGINX, degraded: false });

    const tabs = await screen.findByRole('navigation', { name: 'Repository sections' });
    const overview = within(tabs).getByRole('link', { name: 'Overview' });
    const tags = within(tabs).getByRole('link', { name: 'Tags' });
    expect(overview).toHaveAttribute('href', '/_/nginx');
    expect(tags).toHaveAttribute('href', '/_/nginx/tags');
    expect(overview).toHaveAttribute('aria-current', 'page');
    expect(tags).not.toHaveAttribute('aria-current');

    fireEvent.click(tags);
    expect(await screen.findByRole('heading', { name: 'No tags yet' })).toBeInTheDocument();
    expect(tags).toHaveAttribute('aria-current', 'page');
    expect(overview).not.toHaveAttribute('aria-current');
  });

  it('opens on the Tags tab from its URL', async () => {
    renderPage('/r/fluent/fluent-bit/tags', { repo: FLUENT_BIT, degraded: false });
    expect(await screen.findByRole('heading', { name: 'No tags yet' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Tags' })).toHaveAttribute('aria-current', 'page');
  });

  it('renders the overview as sanitized Markdown', async () => {
    const { container } = renderPage('/r/fluent/fluent-bit', {
      repo: FLUENT_BIT,
      degraded: false,
    });

    expect(await screen.findByRole('heading', { level: 2, name: 'Fluent Bit' })).toBeVisible();
    expect(screen.getByRole('link', { name: 'the docs' })).toHaveAttribute(
      'rel',
      'noopener noreferrer nofollow',
    );
    expect(container.querySelector('script')).toBeNull();
  });

  it('shows an empty state, pointing to the tags, when there is no overview', async () => {
    renderPage('/r/fluent/fluent-bit', {
      repo: { ...FLUENT_BIT, fullDescriptionMd: '  \n ' },
      degraded: false,
    });

    expect(await screen.findByRole('heading', { name: 'No overview yet' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'View tags' })).toHaveAttribute(
      'href',
      '/r/fluent/fluent-bit/tags',
    );
  });

  it('shows the degraded banner when the data is a stale copy', async () => {
    renderPage('/_/nginx', { repo: NGINX, degraded: true });
    expect(await screen.findByText('Showing saved data.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });

  it('shows a loading state while another page loads, but not once a tab has loaded', async () => {
    const Page = () => {
      const loaderData = useLoaderData<RepoPageData>();
      const Component = RepoPage as unknown as React.ComponentType<{ loaderData: RepoPageData }>;
      return <Component loaderData={loaderData} />;
    };
    const router = createMemoryRouter(
      [
        {
          path: '/r/:ns/:repo',
          // Another repository's data never arrives, so the navigation stays pending.
          loader: ({ params }) =>
            params.ns === 'fluent'
              ? { repo: FLUENT_BIT, degraded: false }
              : new Promise<never>(() => {}),
          Component: Page,
          children: [
            { index: true, Component: RepoOverview },
            { path: 'tags', loader: () => NO_TAGS, Component: TagsWithData },
          ],
        },
      ],
      { initialEntries: ['/r/fluent/fluent-bit'] },
    );
    render(<RouterProvider router={router} />);
    await screen.findByRole('heading', { level: 2, name: 'Fluent Bit' });

    await act(() => router.navigate('/r/fluent/fluent-bit/tags'));
    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.getByRole('heading', { name: 'No tags yet' })).toBeInTheDocument();

    // Not awaited: the navigation never settles.
    act(() => {
      void router.navigate('/r/other/repo');
    });
    expect(await screen.findByRole('status')).toHaveTextContent('Loading');
    expect(screen.queryByRole('heading', { name: 'No tags yet' })).toBeNull();
  });

  it('shows no degraded banner for fresh data', async () => {
    renderPage('/_/nginx', { repo: NGINX, degraded: false });
    await screen.findByRole('heading', { level: 1 });
    expect(screen.queryByText('Showing saved data.')).toBeNull();
  });
});

describe('repository page meta', () => {
  const args = (data: RepoPageData | undefined) =>
    ({ data }) as unknown as Parameters<typeof meta>[0];

  it('titles the page after the repository, with its description', () => {
    expect(meta(args({ repo: NGINX, degraded: false }))).toEqual([
      { title: "nginx | Danny's Dockers" },
      { name: 'description', content: 'Official build of Nginx.' },
    ]);
  });

  it('falls back to the app name without data (the error boundary sets its own title)', () => {
    expect(meta(args(undefined))).toEqual([{ title: "Danny's Dockers" }]);
  });

  it('omits the description meta when the repository has none', () => {
    expect(meta(args({ repo: { ...NGINX, description: '' }, degraded: false }))).toEqual([
      { title: "nginx | Danny's Dockers" },
    ]);
  });
});

describe('repository layout shouldRevalidate', () => {
  const FLUENT = { ns: 'fluent', repo: 'fluent-bit' };
  const args = (
    from: string,
    to: string,
    extra: Partial<Parameters<typeof shouldRevalidate>[0]> = {},
  ) =>
    ({
      currentUrl: new URL(from, 'http://localhost'),
      nextUrl: new URL(to, 'http://localhost'),
      currentParams: FLUENT,
      nextParams: FLUENT,
      defaultShouldRevalidate: true,
      ...extra,
    }) as Parameters<typeof shouldRevalidate>[0];

  it.each([
    ['/r/fluent/fluent-bit/tags', '/r/fluent/fluent-bit/tags?ordering=-name'],
    ['/r/fluent/fluent-bit/tags?name=a', '/r/fluent/fluent-bit/tags?name=al'],
    ['/r/fluent/fluent-bit', '/r/fluent/fluent-bit/tags?name=a'],
  ])('skips the repository loader from %s to %s (same repository)', (from, to) => {
    expect(shouldRevalidate(args(from, to))).toBe(false);
  });

  it('skips the repository loader for the tag filter form (a GET submission)', () => {
    const tags = '/r/fluent/fluent-bit/tags';
    expect(shouldRevalidate(args(tags, `${tags}?name=al`, { formMethod: 'GET' }))).toBe(false);
  });

  it('revalidates on "Try again" (same URL) and after a form post', () => {
    const tags = '/r/fluent/fluent-bit/tags';
    expect(shouldRevalidate(args(tags, tags))).toBe(true);
    expect(shouldRevalidate(args(tags, `${tags}?name=a`, { formMethod: 'POST' }))).toBe(true);
  });

  it('defers to the default for another repository', () => {
    const other = { ns: 'nginxdemos', repo: 'hello' };
    expect(
      shouldRevalidate(args('/r/fluent/fluent-bit', '/r/nginxdemos/hello', { nextParams: other })),
    ).toBe(true);
  });
});
