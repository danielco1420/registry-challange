import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { createRoutesStub, useLocation } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Initializes the shared i18next instance, as app/root.tsx does in the app.
import '~/i18n/i18next';
import type { RepoSummary, SearchPage } from '~/lib/dto';
import { RECENT_SEARCHES_KEY } from '~/lib/recent-searches';

import { server } from '../../../test/msw/server';
import { SearchBar } from './search-bar';
import { resetRecentSearchesStore } from './use-recent-searches';

const SUGGESTIONS = '*/api/search/suggestions';

function repo(namespace: string, name: string, description = ''): RepoSummary {
  return {
    id: `${namespace}/${name}`,
    namespace,
    name,
    displayName: namespace === 'library' ? name : `${namespace}/${name}`,
    owner: namespace,
    description,
    badge: namespace === 'library' ? 'official' : 'none',
    pulls: 0,
    pullsLabel: '0',
    stars: 0,
    updatedAt: '',
    archs: [],
    archived: false,
  };
}

function page(items: RepoSummary[]): SearchPage {
  return { items, total: items.length, page: 1, pageSize: 10, source: 'v4' };
}

/** Answers every suggestions request with `items`, and records the queries asked for. */
function serveSuggestions(items: RepoSummary[] = []) {
  const queries: string[] = [];
  server.use(
    http.get(SUGGESTIONS, ({ request }) => {
      queries.push(new URL(request.url).searchParams.get('q') ?? '');
      return HttpResponse.json(page(items));
    }),
  );
  return queries;
}

function LocationProbe() {
  const location = useLocation();
  return <output data-testid="location">{location.pathname + location.search}</output>;
}

function renderSearchBar(initialPath = '/r/some/where') {
  const Stub = createRoutesStub([
    {
      path: '*',
      Component: () => (
        <>
          <SearchBar />
          <LocationProbe />
        </>
      ),
    },
  ]);
  render(<Stub initialEntries={[initialPath]} />);
}

async function getInput() {
  return screen.findByRole('combobox', { name: 'Search images' });
}

function currentLocation() {
  return screen.getByTestId('location').textContent;
}

async function focusAndType(value: string) {
  const input = await getInput();
  act(() => input.focus());
  fireEvent.change(input, { target: { value } });
  return input;
}

/** The popup's visible message (the live region repeats it for screen readers). */
async function findMessage(text: string) {
  const matches = await screen.findAllByText(text);
  const visible = matches.find((el) => el.getAttribute('role') !== 'status');
  if (!visible) throw new Error(`No visible message "${text}"`);
  return visible;
}

function storedSearches(): unknown {
  return JSON.parse(localStorage.getItem(RECENT_SEARCHES_KEY) ?? 'null');
}

beforeEach(() => {
  localStorage.clear();
  resetRecentSearchesStore();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('SearchBar', () => {
  it('is a plain GET form to /search with a q field, so it works without JavaScript', async () => {
    renderSearchBar();
    const input = await getInput();
    const form = screen.getByRole('search', { name: 'Search images' });
    expect(form.tagName).toBe('FORM');
    expect(form).toHaveAttribute('method', 'get');
    expect(form).toHaveAttribute('action', '/search');
    expect(input).toHaveAttribute('name', 'q');
    expect(form).toContainElement(screen.getByRole('button', { name: 'Search' }));
  });

  it('submits to /search?q= and remembers the query', async () => {
    serveSuggestions();
    renderSearchBar();
    await focusAndType('postgres');
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));

    await waitFor(() => expect(currentLocation()).toBe('/search?q=postgres'));
    expect(storedSearches()).toEqual(['postgres']);
  });

  it('shows the current query on the results page', async () => {
    renderSearchBar('/search?q=redis');
    expect(await getInput()).toHaveValue('redis');
  });

  it('asks for suggestions once typing pauses, not on every keystroke', async () => {
    const queries = serveSuggestions([repo('library', 'nginx', 'Official build of Nginx.')]);
    renderSearchBar();
    const input = await focusAndType('ngi');
    fireEvent.change(input, { target: { value: 'ngin' } });
    fireEvent.change(input, { target: { value: 'nginx' } });

    const listbox = await screen.findByRole('listbox', { name: 'Suggestions' });
    expect(within(listbox).getByRole('option', { name: /nginx/ })).toBeInTheDocument();
    expect(queries).toEqual(['nginx']);
    expect(input).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('status')).toHaveTextContent('1 suggestion available.');
  });

  it('does not ask for suggestions for a single character', async () => {
    const queries = serveSuggestions([repo('library', 'nginx')]);
    renderSearchBar();
    const input = await focusAndType('n');
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(queries).toEqual([]);
    expect(input).toHaveAttribute('aria-expanded', 'false');
  });

  it('never lets an older response overwrite a newer one', async () => {
    let releaseOld!: () => void;
    const oldResponseHeld = new Promise<void>((resolve) => (releaseOld = resolve));
    const requests: { q: string; signal: AbortSignal }[] = [];
    server.use(
      http.get(SUGGESTIONS, async ({ request }) => {
        const q = new URL(request.url).searchParams.get('q') ?? '';
        requests.push({ q, signal: request.signal });
        if (q === 'red') {
          // The older request answers last.
          await oldResponseHeld;
          return HttpResponse.json(page([repo('library', 'stale-result')]));
        }
        return HttpResponse.json(page([repo('library', 'redmine')]));
      }),
    );
    renderSearchBar();
    const input = await focusAndType('red');
    await waitFor(() => expect(requests.map((r) => r.q)).toEqual(['red']));

    fireEvent.change(input, { target: { value: 'redm' } });
    expect(await screen.findByRole('option', { name: /redmine/ })).toBeInTheDocument();

    releaseOld();
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(requests.map((r) => r.q)).toEqual(['red', 'redm']);
    expect(requests[0]?.signal.aborted).toBe(true);
    expect(screen.queryByRole('option', { name: /stale-result/ })).not.toBeInTheDocument();
    expect(screen.getByRole('option', { name: /redmine/ })).toBeInTheDocument();
  });

  it('says so when there are no suggestions', async () => {
    serveSuggestions([]);
    renderSearchBar();
    const input = await focusAndType('zzzzqqq');

    expect(
      await findMessage('No suggestions for “zzzzqqq”. Press Enter to search anyway.'),
    ).toBeVisible();
    expect(screen.queryAllByRole('option')).toHaveLength(0);
    expect(input).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByRole('status')).toHaveTextContent('No suggestions for “zzzzqqq”');
  });

  it('shows a loading state while waiting', async () => {
    server.use(http.get(SUGGESTIONS, () => new Promise<never>(() => {})));
    renderSearchBar();
    await focusAndType('mysql');
    expect(await findMessage('Loading suggestions…')).toBeVisible();
  });

  it('keeps the search box working when suggestions fail', async () => {
    server.use(
      http.get(SUGGESTIONS, () =>
        HttpResponse.json(
          { error: { code: 'upstream_unavailable', message: 'Docker Hub is unavailable.' } },
          { status: 503 },
        ),
      ),
    );
    renderSearchBar();
    await focusAndType('mongo');

    expect(
      await findMessage('Suggestions are unavailable right now. Press Enter to search.'),
    ).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    await waitFor(() => expect(currentLocation()).toBe('/search?q=mongo'));
  });

  it('treats an unexpected response body as an error', async () => {
    server.use(http.get(SUGGESTIONS, () => HttpResponse.json({ results: [] })));
    renderSearchBar();
    await focusAndType('mongo');
    expect(
      await findMessage('Suggestions are unavailable right now. Press Enter to search.'),
    ).toBeVisible();
  });

  it('moves through suggestions with the arrow keys and opens the chosen one', async () => {
    serveSuggestions([repo('library', 'nginx'), repo('bitnami', 'nginx')]);
    renderSearchBar();
    const input = await focusAndType('nginx');
    const options = await screen.findAllByRole('option');
    expect(options).toHaveLength(2);
    expect(input).not.toHaveAttribute('aria-activedescendant');

    fireEvent.keyDown(input, { key: 'ArrowDown' });
    expect(input).toHaveAttribute('aria-activedescendant', options[0]?.id);
    expect(options[0]).toHaveAttribute('aria-selected', 'true');

    fireEvent.keyDown(input, { key: 'ArrowDown' });
    expect(input).toHaveAttribute('aria-activedescendant', options[1]?.id);
    // Wraps around at both ends.
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    expect(input).toHaveAttribute('aria-activedescendant', options[0]?.id);
    fireEvent.keyDown(input, { key: 'ArrowUp' });
    expect(input).toHaveAttribute('aria-activedescendant', options[1]?.id);

    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(currentLocation()).toBe('/r/bitnami/nginx'));
  });

  it('opens an official image at /_/{repo} when clicked', async () => {
    serveSuggestions([repo('library', 'nginx')]);
    renderSearchBar();
    await focusAndType('nginx');
    fireEvent.click(await screen.findByRole('option', { name: /nginx/ }));
    await waitFor(() => expect(currentLocation()).toBe('/_/nginx'));
  });

  it('closes the list on Escape and keeps the text', async () => {
    serveSuggestions([repo('library', 'nginx')]);
    renderSearchBar();
    const input = await focusAndType('nginx');
    await screen.findByRole('option', { name: /nginx/ });

    fireEvent.keyDown(input, { key: 'Escape' });
    expect(input).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('option')).not.toBeInTheDocument();
    expect(input).toHaveValue('nginx');

    // ArrowDown opens it again.
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    expect(await screen.findByRole('option', { name: /nginx/ })).toBeInTheDocument();
  });

  it('closes the list when focus leaves the search box', async () => {
    serveSuggestions([repo('library', 'nginx')]);
    renderSearchBar();
    const input = await focusAndType('nginx');
    await screen.findByRole('option', { name: /nginx/ });

    fireEvent.blur(input, { relatedTarget: document.body });
    expect(input).toHaveAttribute('aria-expanded', 'false');
  });

  describe('recent searches', () => {
    it('lists them when the box is empty and searches one again when picked', async () => {
      localStorage.setItem(RECENT_SEARCHES_KEY, JSON.stringify(['nginx', 'redis']));
      renderSearchBar();
      const input = await getInput();
      act(() => input.focus());

      const listbox = await screen.findByRole('listbox', { name: 'Recent searches' });
      const options = within(listbox).getAllByRole('option');
      expect(options.map((o) => o.textContent)).toEqual(['nginx', 'redis']);

      fireEvent.keyDown(input, { key: 'ArrowUp' });
      fireEvent.keyDown(input, { key: 'Enter' });
      await waitFor(() => expect(currentLocation()).toBe('/search?q=redis'));
      expect(storedSearches()).toEqual(['redis', 'nginx']);
    });

    it('can be cleared', async () => {
      localStorage.setItem(RECENT_SEARCHES_KEY, JSON.stringify(['nginx']));
      renderSearchBar();
      act(() => screen.getByRole('combobox').focus());

      fireEvent.click(await screen.findByRole('button', { name: 'Clear recent searches' }));
      expect(screen.queryByRole('option')).not.toBeInTheDocument();
      expect(localStorage.getItem(RECENT_SEARCHES_KEY)).toBeNull();
    });

    it('ignores a corrupt stored value', async () => {
      localStorage.setItem(RECENT_SEARCHES_KEY, '{not json');
      renderSearchBar();
      act(() => screen.getByRole('combobox').focus());
      expect(screen.queryByRole('option')).not.toBeInTheDocument();
    });

    it('still work for this page when storage is blocked', async () => {
      vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
        throw new DOMException('The operation is insecure.', 'SecurityError');
      });
      vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
        throw new DOMException('The operation is insecure.', 'SecurityError');
      });
      serveSuggestions();
      renderSearchBar();
      const input = await focusAndType('nginx');
      fireEvent.click(screen.getByRole('button', { name: 'Search' }));
      await waitFor(() => expect(currentLocation()).toBe('/search?q=nginx'));

      fireEvent.change(input, { target: { value: '' } });
      expect(await screen.findByRole('option', { name: 'nginx' })).toBeInTheDocument();
    });
  });
});
