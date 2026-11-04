import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type * as React from 'react';
import {
  createMemoryRouter,
  RouterProvider,
  useLoaderData,
  type LoaderFunctionArgs,
} from 'react-router';
import { describe, expect, it } from 'vitest';

import '~/i18n/i18next';

import type { Page, RepoDetails, Tag } from '~/lib/dto';
import {
  parseTagsUrl,
  type ParsedTagsUrl,
  type TagsResult,
  type TagsTabData,
} from '~/lib/tags-query';
import type { RepoPageData } from '~/server/repo.server';

import RepoPage from './repo';
import RepoTags from './repo.tags';

const FLUENT_BIT: RepoDetails = {
  id: 'fluent/fluent-bit',
  namespace: 'fluent',
  name: 'fluent-bit',
  displayName: 'fluent/fluent-bit',
  owner: 'fluent',
  description: 'Fast and lightweight logs and metrics processor.',
  badge: 'open_source',
  pulls: 1_234_567_890,
  pullsLabel: '1.2B',
  stars: 2100,
  updatedAt: '2026-10-30T12:00:00Z',
  archs: [],
  archived: false,
  fullDescriptionMd: '# Fluent Bit',
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
  badge: 'official',
};

const tag = (name: string): Tag => ({
  name,
  updatedAt: '2026-10-30T12:00:00Z',
  size: 62_592_256,
  images: [],
});

/** Page `page` of a `total`-tag list, 50 per page, tags named `t0`, `t1`, …. */
function pageOf(page: number, total: number): Page<Tag> {
  const start = (page - 1) * 50;
  const count = Math.max(0, Math.min(50, total - start));
  return {
    items: Array.from({ length: count }, (_, i) => tag(`t${start + i}`)),
    total,
    page,
    pageSize: 50,
  };
}

const ok = (tags: Page<Tag>): TagsResult => ({ ok: true, tags, degraded: false });

/** A route module's default export, fed its loader data as `useLoaderData` gives it. */
function withLoaderData<T>(Component: unknown) {
  const Inner = Component as React.ComponentType<{ loaderData: T }>;
  return function Route() {
    return <Inner loaderData={useLoaderData() as T} />;
  };
}

/**
 * The repository layout and the Tags tab, as `app/routes.ts` wires them. The
 * tab's loader answers with `answer(url)` and records every URL it was asked
 * for, first page and "Load more" alike.
 */
function renderTags(
  path: string,
  answer: (url: ParsedTagsUrl) => TagsResult | Promise<TagsResult>,
  repo: RepoDetails = FLUENT_BIT,
) {
  const requests: ParsedTagsUrl[] = [];
  const tagsLoader = async ({ request }: LoaderFunctionArgs): Promise<TagsTabData> => {
    const url = parseTagsUrl(new URL(request.url).searchParams);
    requests.push(url);
    return { ...url, result: await answer(url) };
  };
  const layout = {
    loader: (): RepoPageData => ({ repo, degraded: false }),
    Component: withLoaderData<RepoPageData>(RepoPage),
    children: [
      { index: true, Component: () => <p>Overview</p> },
      { path: 'tags', loader: tagsLoader, Component: withLoaderData<TagsTabData>(RepoTags) },
    ],
  };
  const router = createMemoryRouter(
    [
      { path: '/r/:ns/:repo', ...layout },
      { path: '/_/:repo', ...layout },
    ],
    { initialEntries: [path] },
  );
  render(<RouterProvider router={router} />);
  return { router, requests };
}

const table = () => screen.findByRole('table', { name: /^Tags of / });
/**
 * The tag names in the table, in order. `hidden: true` skips Testing Library's
 * CSS visibility check, which costs jsdom about 0.5 s per call over 100+ rows
 * and made `waitFor` polls on it slow enough to time out. The filter keeps
 * only the tags table's own row headers, not an expanded platform table's.
 */
const rowNames = () => {
  const tags = screen.getByRole('table', { name: /^Tags of / });
  return within(tags)
    .getAllByRole('rowheader', { hidden: true })
    .filter((cell) => cell.closest('table') === tags)
    .map((cell) => cell.textContent);
};
const columnHeader = (name: string) => screen.getByRole('columnheader', { name: new RegExp(name) });

describe('Tags tab: table', () => {
  it('lists tags with last updated, size and a copyable pull command', async () => {
    renderTags('/r/fluent/fluent-bit/tags', () => ok(pageOf(1, 3)));

    await table();
    expect(screen.getByText('3 tags')).toBeInTheDocument();
    expect(rowNames()).toEqual(['t0', 't1', 't2']);

    const row = screen.getByRole('row', { name: /^t0/ });
    expect(within(row).getByText('62.6 MB')).toBeInTheDocument();
    expect(row.querySelector('time')).toHaveAttribute('dateTime', '2026-10-30T12:00:00Z');
    expect(within(row).getByText('docker pull fluent/fluent-bit:t0')).toBeInTheDocument();
    expect(
      within(row).getByRole('button', { name: 'Copy docker pull fluent/fluent-bit:t0' }),
    ).toBeInTheDocument();
  });

  it('leaves the `library` namespace out of an official image’s pull command', async () => {
    renderTags('/_/nginx/tags', () => ok({ ...pageOf(1, 1), items: [tag('latest')] }), NGINX);

    await table();
    expect(screen.getByText('docker pull nginx:latest')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Copy docker pull nginx:latest' }),
    ).toBeInTheDocument();
    expect(screen.queryByText(/library\//)).toBeNull();
  });

  it('shows "—" for an unknown size or date', async () => {
    renderTags('/r/fluent/fluent-bit/tags', () =>
      ok({ ...pageOf(1, 1), items: [{ ...tag('old'), size: 0, updatedAt: '' }] }),
    );
    await table();
    const row = screen.getByRole('row', { name: /^old/ });
    expect(within(row).getAllByText('—')).toHaveLength(2);
  });
});

describe('Tags tab: sorting', () => {
  it('marks the current sort and links each sortable header to the next one', async () => {
    renderTags('/r/fluent/fluent-bit/tags?name=3.1', () => ok(pageOf(1, 3)));
    await table();

    // Default: newest first.
    expect(columnHeader('Last updated')).toHaveAttribute('aria-sort', 'descending');
    expect(columnHeader('Tag')).toHaveAttribute('aria-sort', 'none');
    expect(columnHeader('Size')).not.toHaveAttribute('aria-sort');
    expect(within(columnHeader('Size')).queryByRole('link')).toBeNull();

    // The filter is kept; the default ordering is left out of the URL.
    expect(within(columnHeader('Tag')).getByRole('link')).toHaveAttribute(
      'href',
      '/r/fluent/fluent-bit/tags?name=3.1&ordering=-name',
    );
    expect(within(columnHeader('Last updated')).getByRole('link')).toHaveAttribute(
      'href',
      '/r/fluent/fluent-bit/tags?name=3.1&ordering=-last_updated',
    );
  });

  it('a header click puts the new ordering in the URL and reloads the list', async () => {
    const { router, requests } = renderTags('/r/fluent/fluent-bit/tags', () => ok(pageOf(1, 3)));
    await table();

    fireEvent.click(within(columnHeader('Tag')).getByRole('link'));
    await waitFor(() => expect(columnHeader('Tag')).toHaveAttribute('aria-sort', 'ascending'));
    expect(router.state.location.search).toBe('?ordering=-name');
    expect(requests.at(-1)).toMatchObject({ ordering: '-name', page: 1 });
    expect(columnHeader('Last updated')).toHaveAttribute('aria-sort', 'none');

    // A second click flips it.
    fireEvent.click(within(columnHeader('Tag')).getByRole('link'));
    await waitFor(() => expect(columnHeader('Tag')).toHaveAttribute('aria-sort', 'descending'));
    expect(router.state.location.search).toBe('?ordering=name');
  });
});

describe('Tags tab: name filter', () => {
  const filter = () => screen.getByRole('searchbox', { name: 'Filter tags by name' });

  it('updates `name` in the URL after a pause, replacing the history entry', async () => {
    const { router, requests } = renderTags('/r/fluent/fluent-bit/tags?ordering=-name', () =>
      ok(pageOf(1, 3)),
    );
    await table();
    const before = requests.length;

    fireEvent.change(filter(), { target: { value: 'al' } });
    fireEvent.change(filter(), { target: { value: ' alp ' } });
    // Debounced: nothing yet.
    expect(router.state.location.search).toBe('?ordering=-name');

    await waitFor(() => expect(router.state.location.search).toBe('?name=alp&ordering=-name'));
    expect(router.state.historyAction).toBe('REPLACE');
    await waitFor(() => expect(requests.length).toBe(before + 1));
    expect(requests.at(-1)).toMatchObject({ name: 'alp', ordering: '-name' });
    // What was typed stays in the box.
    expect(filter()).toHaveValue(' alp ');
  });

  it('keeps what was typed while an earlier filter was loading, then sends it', async () => {
    let release = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { router, requests } = renderTags('/r/fluent/fluent-bit/tags', async (url) => {
      if (url.name === 'alp') await gate;
      return ok(pageOf(1, 3));
    });
    await table();

    fireEvent.change(filter(), { target: { value: 'alp' } });
    await waitFor(() => expect(requests.at(-1)).toMatchObject({ name: 'alp' }));
    // Typed on while `?name=alp` is still loading.
    fireEvent.change(filter(), { target: { value: 'alpine' } });
    release();

    await waitFor(() => expect(router.state.location.search).toBe('?name=alp'));
    expect(filter()).toHaveValue('alpine');
    await waitFor(() => expect(router.state.location.search).toBe('?name=alpine'));
    expect(filter()).toHaveValue('alpine');
  });

  it('starts from the URL’s filter', async () => {
    renderTags('/r/fluent/fluent-bit/tags?name=3.1', () => ok(pageOf(1, 3)));
    await table();
    expect(filter()).toHaveValue('3.1');
    expect(screen.getByText('3 tags match “3.1”')).toBeInTheDocument();
  });

  it('flags characters no tag can have, without a request', async () => {
    const { router, requests } = renderTags('/r/fluent/fluent-bit/tags', () => ok(pageOf(1, 3)));
    await table();
    const before = requests.length;

    fireEvent.change(filter(), { target: { value: 'alp*' } });
    expect(filter()).toHaveAttribute('aria-invalid', 'true');
    expect(filter()).toHaveAccessibleDescription(/letters, digits/);

    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(router.state.location.search).toBe('');
    expect(requests.length).toBe(before);
  });

  it('"no tags match", with a "Clear filter" that empties the box', async () => {
    const { router } = renderTags('/r/fluent/fluent-bit/tags?name=zzz', (url) =>
      ok(url.name ? pageOf(1, 0) : pageOf(1, 3)),
    );

    expect(await screen.findByRole('heading', { name: 'No tags match “zzz”' })).toBeInTheDocument();
    expect(screen.queryByRole('table')).toBeNull();
    const clear = screen.getByRole('link', { name: 'Clear filter' });
    expect(clear).toHaveAttribute('href', '/r/fluent/fluent-bit/tags');

    fireEvent.click(clear);
    await table();
    expect(router.state.location.search).toBe('');
    expect(filter()).toHaveValue('');
  });
});

describe('Tags tab: load more', () => {
  it('fetches one more page per click and appends it, until the last', async () => {
    const { router, requests } = renderTags('/r/fluent/fluent-bit/tags', (url) =>
      ok(pageOf(url.page, 120)),
    );
    await table();
    expect(rowNames()).toHaveLength(50);
    expect(screen.getByText('Showing 50 of 120.')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Load more tags' }));
    await waitFor(() => expect(rowNames()).toHaveLength(100));
    expect(requests.at(-1)).toMatchObject({ page: 2, ordering: 'last_updated' });
    // A fetcher: the address bar doesn't change.
    expect(router.state.location.search).toBe('');

    fireEvent.click(screen.getByRole('button', { name: 'Load more tags' }));
    await waitFor(() => expect(rowNames()).toHaveLength(120));
    expect(rowNames().at(-1)).toBe('t119');
    expect(screen.queryByRole('button', { name: 'Load more tags' })).toBeNull();
    expect(screen.queryByText(/^Showing/)).toBeNull();
    expect(requests.map((r) => r.page)).toEqual([1, 2, 3]);
    // Each "Load more tags" query computes the accessible name of every button
    // (a platforms toggle and a Copy per row, 240 at the end), about 1 s each in
    // jsdom. The test takes about 3 s locally; this leaves room for a slow runner.
  }, 15_000);

  it('keeps the current sort and filter when loading more', async () => {
    const { requests } = renderTags('/r/fluent/fluent-bit/tags?name=3&ordering=-name', (url) =>
      ok(pageOf(url.page, 120)),
    );
    await table();
    fireEvent.click(screen.getByRole('button', { name: 'Load more tags' }));
    await waitFor(() => expect(rowNames()).toHaveLength(100));
    expect(requests.at(-1)).toEqual({ page: 2, name: '3', ordering: '-name' });
  });

  it('does not repeat a tag that moved to the next page', async () => {
    renderTags('/r/fluent/fluent-bit/tags', (url) =>
      ok(
        url.page === 1
          ? pageOf(1, 120)
          : { ...pageOf(2, 120), items: [tag('t49'), ...pageOf(2, 120).items.slice(1)] },
      ),
    );
    await table();
    fireEvent.click(screen.getByRole('button', { name: 'Load more tags' }));
    await waitFor(() => expect(rowNames()).toHaveLength(99));
    expect(rowNames().filter((name) => name === 't49')).toHaveLength(1);
  });

  it('a failed page shows an inline error and keeps the rows; "Try again" retries', async () => {
    let failNext = true;
    renderTags('/r/fluent/fluent-bit/tags', (url) => {
      if (url.page === 2 && failNext) {
        failNext = false;
        return { ok: false, error: 'unavailable', retryAfterSeconds: 5 };
      }
      return ok(pageOf(url.page, 120));
    });
    await table();

    fireEvent.click(screen.getByRole('button', { name: 'Load more tags' }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent("Couldn't load more tags. Docker Hub is unavailable.");
    expect(alert).toHaveTextContent('You can try again in 5 seconds.');
    expect(rowNames()).toHaveLength(50);

    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(rowNames()).toHaveLength(100));
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it("stops at Docker Hub's 1000-tag cap and says how to find the rest", async () => {
    // Page 20 of 50 is the last one anonymous paging reaches (20 × 50 = 1000).
    renderTags('/r/fluent/fluent-bit/tags?page=20', (url) => ok(pageOf(url.page, 2189)));
    await table();

    expect(screen.queryByRole('button', { name: 'Load more tags' })).toBeNull();
    expect(
      screen.getByText(/Docker Hub lists only the first 1,000 tags without sign-in/),
    ).toBeInTheDocument();
    expect(screen.getByText('2,189 tags')).toBeInTheDocument();
  });

  it('starts over on a new sort: rows from "Load more" are dropped', async () => {
    renderTags('/r/fluent/fluent-bit/tags', (url) => ok(pageOf(url.page, 120)));
    await table();
    fireEvent.click(screen.getByRole('button', { name: 'Load more tags' }));
    await waitFor(() => expect(rowNames()).toHaveLength(100));

    fireEvent.click(within(columnHeader('Tag')).getByRole('link'));
    await waitFor(() => expect(columnHeader('Tag')).toHaveAttribute('aria-sort', 'ascending'));
    expect(rowNames()).toHaveLength(50);
  });
});

describe('Tags tab: states', () => {
  it('a repository without tags: "No tags yet", pointing back to the overview', async () => {
    renderTags('/_/nginx/tags', () => ok(pageOf(1, 0)), NGINX);
    expect(await screen.findByRole('heading', { name: 'No tags yet' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back to overview' })).toHaveAttribute(
      'href',
      '/_/nginx',
    );
  });

  it('Docker Hub unavailable: an error state with "Try again" that reloads the list', async () => {
    let fail = true;
    renderTags('/r/fluent/fluent-bit/tags', () =>
      fail ? { ok: false, error: 'unavailable', retryAfterSeconds: 30 } : ok(pageOf(1, 3)),
    );

    expect(
      await screen.findByRole('heading', { name: 'Docker Hub is unavailable' }),
    ).toBeInTheDocument();
    expect(screen.getByText(/You can try again in 30 seconds\./)).toBeInTheDocument();
    // The repository header and tabs stay.
    expect(
      screen.getByRole('heading', { level: 1, name: 'fluent/fluent-bit' }),
    ).toBeInTheDocument();

    fail = false;
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await table();
  });

  it('rate limited: says so', async () => {
    renderTags('/r/fluent/fluent-bit/tags', () => ({ ok: false, error: 'rate_limited' }));
    expect(await screen.findByRole('heading', { name: 'Too many requests' })).toBeInTheDocument();
  });

  it('repository not found: no "Try again"', async () => {
    renderTags('/r/fluent/fluent-bit/tags', () => ({ ok: false, error: 'repo_not_found' }));
    expect(
      await screen.findByRole('heading', { name: 'Repository not found' }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
  });

  it('a stale copy: the list, with the degraded banner', async () => {
    renderTags('/r/fluent/fluent-bit/tags', () => ({
      ok: true,
      tags: pageOf(1, 3),
      degraded: true,
    }));
    await table();
    expect(screen.getByText('Showing saved data.')).toBeInTheDocument();
  });

  it('shows a loading state while a new sort loads, keeping the rows', async () => {
    let release: () => void = () => {};
    const { router } = renderTags('/r/fluent/fluent-bit/tags', (url) =>
      url.ordering === 'last_updated'
        ? ok(pageOf(1, 3))
        : new Promise<TagsResult>((resolve) => {
            release = () => resolve(ok(pageOf(1, 3)));
          }),
    );
    await table();

    act(() => {
      void router.navigate('/r/fluent/fluent-bit/tags?ordering=-name');
    });
    expect(await screen.findByText('Loading tags…')).toBeInTheDocument();
    expect(rowNames()).toHaveLength(3);

    await act(async () => release());
    await waitFor(() => expect(screen.queryByText('Loading tags…')).toBeNull());
  });
});
