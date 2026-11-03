/**
 * The root `ErrorBoundary` end to end: page loaders that throw what
 * `toPageErrorResponse` builds from upstream failures, an unmatched URL and a
 * render error, each mapped to its error state.
 */
import { fireEvent, render, screen } from '@testing-library/react';
import type * as React from 'react';
import { createRoutesStub, Outlet } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ErrorBoundary, headers } from './root';
import { pageNotFound, toPageErrorResponse } from './server/pageError.server';
import { rateLimitedResponse } from './server/rateLimit.server';
import { UpstreamUnavailableError } from './server/upstream.server';

afterEach(() => {
  vi.restoreAllMocks();
});

function renderApp(
  path: string,
  page: { loader?: () => unknown; Component?: React.ComponentType },
) {
  const Stub = createRoutesStub([
    {
      path: '/',
      Component: Outlet,
      ErrorBoundary: ErrorBoundary as unknown as React.ComponentType,
      children: [
        { index: true, Component: () => <p>Explore</p> },
        {
          path: 'r/:ns/:repo',
          loader: page.loader ?? (() => null),
          Component: page.Component ?? (() => <p>Repository page</p>),
        },
      ],
    },
  ]);
  return render(<Stub initialEntries={[path]} />);
}

describe('root headers', () => {
  const args = (errorHeaders?: Headers) => ({
    loaderHeaders: new Headers(),
    parentHeaders: new Headers(),
    actionHeaders: new Headers(),
    errorHeaders,
  });

  it("passes a thrown page error's Retry-After and no-store on to the document", () => {
    const thrown = new Headers({ 'Retry-After': '7', 'Cache-Control': 'no-store' });
    const result = new Headers(headers(args(thrown)));
    expect(result.get('Retry-After')).toBe('7');
    expect(result.get('Cache-Control')).toBe('no-store');
  });

  it('adds nothing without an error', () => {
    expect([...new Headers(headers(args())).keys()]).toEqual([]);
  });
});

describe('root ErrorBoundary', () => {
  it('shows "repository not found" for a missing repository, with a way back', async () => {
    renderApp('/r/acme/missing', {
      loader: () => {
        throw toPageErrorResponse(pageNotFound('repo_not_found'));
      },
    });

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Repository not found' }),
    ).toBeInTheDocument();
    expect(document.title).toBe('Repository not found');

    fireEvent.click(screen.getByRole('link', { name: 'Back to Explore' }));
    expect(await screen.findByText('Explore')).toBeInTheDocument();
  });

  it('shows the generic 404 for an unmatched URL', async () => {
    renderApp('/no/such/page', {});

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Page not found' }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument();
  });

  it('shows "Docker Hub unavailable", and "Try again" reruns the loader', async () => {
    let fail = true;
    const loader = vi.fn(() => {
      if (fail) throw toPageErrorResponse(new UpstreamUnavailableError('upstream_failed', 4));
      return null;
    });
    renderApp('/r/library/nginx', { loader });

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Docker Hub is unavailable' }),
    ).toBeInTheDocument();
    expect(screen.getByText(/You can try again in 4 seconds\./)).toBeInTheDocument();

    fail = false;
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('Repository page')).toBeInTheDocument();
    expect(loader).toHaveBeenCalledTimes(2);
  });

  it('shows "Docker Hub unavailable" when the upstream budget is spent (ADR-0003)', async () => {
    renderApp('/r/library/nginx', {
      loader: () => {
        throw toPageErrorResponse(new UpstreamUnavailableError('budget_exhausted', 20));
      },
    });

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Docker Hub is unavailable' }),
    ).toBeInTheDocument();
    expect(screen.getByText(/You can try again in 20 seconds\./)).toBeInTheDocument();
  });

  it('shows "too many requests" for the per-client rate limit, with the wait', async () => {
    renderApp('/r/library/nginx', {
      loader: () => {
        throw toPageErrorResponse(rateLimitedResponse({ retryAfterSeconds: 9 }));
      },
    });

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Too many requests' }),
    ).toBeInTheDocument();
    expect(screen.getByText(/You can try again in 9 seconds\./)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });

  it('still shows "too many requests", with the wait, for a raw 429 thrown without the mapping', async () => {
    renderApp('/r/library/nginx', {
      loader: () => {
        throw rateLimitedResponse({ retryAfterSeconds: 9 });
      },
    });

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Too many requests' }),
    ).toBeInTheDocument();
    expect(screen.getByText(/You can try again in 9 seconds\./)).toBeInTheDocument();
  });

  it('shows "something went wrong" for a render error, with both next actions', async () => {
    // React logs the error it caught; keep the test output clean.
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    renderApp('/r/library/nginx', {
      Component: () => {
        throw new Error('render bug');
      },
    });

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Something went wrong' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back to Explore' })).toHaveAttribute('href', '/');
  });
});
