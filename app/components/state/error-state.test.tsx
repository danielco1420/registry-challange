import { fireEvent, render, screen } from '@testing-library/react';
import type * as React from 'react';
import { createRoutesStub } from 'react-router';
import { describe, expect, it, vi } from 'vitest';

import '~/i18n/i18next';

import { ErrorState } from './error-state';

// `ErrorState` renders a router `Link`, so it needs a router.
function renderInRouter(element: React.ReactNode) {
  const Stub = createRoutesStub([{ path: '/r/x/y', Component: () => element }]);
  return render(<Stub initialEntries={['/r/x/y']} />);
}

const backToExplore = () => screen.getByRole('link', { name: 'Back to Explore' });

describe('ErrorState', () => {
  it.each([
    ['not_found', 'Page not found', 'Go back to Explore'],
    ['repo_not_found', 'Repository not found', 'go back to Explore to search for it'],
  ] as const)('%s: says so and links back to Explore', (kind, title, nextAction) => {
    renderInRouter(<ErrorState kind={kind} />);

    expect(screen.getByRole('heading', { level: 2, name: title })).toBeInTheDocument();
    expect(screen.getByText(new RegExp(nextAction))).toBeInTheDocument();
    expect(backToExplore()).toHaveAttribute('href', '/');
    expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument();
  });

  it.each([
    ['unavailable', 'Docker Hub is unavailable', 'Try again in a moment.'],
    ['rate_limited', 'Too many requests', 'then try again.'],
    ['unexpected', 'Something went wrong', 'Try again, or go back to Explore.'],
  ] as const)('%s: says so, and offers to try again or go back', (kind, title, nextAction) => {
    const retry = vi.fn();
    renderInRouter(<ErrorState kind={kind} retry={retry} />);

    expect(screen.getByRole('heading', { level: 2, name: title })).toBeInTheDocument();
    expect(screen.getByText(new RegExp(nextAction))).toBeInTheDocument();
    expect(backToExplore()).toHaveAttribute('href', '/');

    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(retry).toHaveBeenCalledOnce();
  });

  it('says when to try again, from Retry-After', () => {
    renderInRouter(
      <ErrorState kind="rate_limited" retry={() => undefined} retryAfterSeconds={12} />,
    );
    expect(screen.getByText(/You can try again in 12 seconds\./)).toBeInTheDocument();
  });

  it('uses the singular for one second', () => {
    renderInRouter(<ErrorState kind="unavailable" retry={() => undefined} retryAfterSeconds={1} />);
    expect(screen.getByText(/You can try again in 1 second\./)).toBeInTheDocument();
  });

  it('labels its section with its heading, at the level asked for', () => {
    renderInRouter(<ErrorState kind="not_found" headingLevel={1} />);

    const heading = screen.getByRole('heading', { level: 1, name: 'Page not found' });
    expect(screen.getByRole('region', { name: 'Page not found' })).toContainElement(heading);
  });
});
