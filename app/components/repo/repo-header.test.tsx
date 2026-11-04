import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import '~/i18n/i18next';

import { FAVORITES_KEY } from '~/lib/favorites';

import { resetFavoritesStore } from './use-favorites';
import { RepoHeader, type RepoHeaderProps } from './repo-header';

const NOW = Date.parse('2026-11-02T12:00:00Z');

const NGINX: RepoHeaderProps['repo'] = {
  id: 'library/nginx',
  namespace: 'library',
  name: 'nginx',
  displayName: 'nginx',
  owner: 'library',
  description: 'Official build of Nginx.',
  logoUrl: 'https://d1q6f0aelx0por.cloudfront.net/product-logos/nginx.png',
  badge: 'official',
  archived: false,
  pulls: 13_543_605_709,
  pullsLabel: '10B+',
  stars: 21_416,
  updatedAt: '2026-10-31T01:52:43.634621Z',
};

beforeEach(() => {
  localStorage.clear();
  resetFavoritesStore();
});

describe('RepoHeader', () => {
  it('shows the name as the h1, the badge, stats and a relative date with the absolute on hover', () => {
    const { container } = render(<RepoHeader repo={NGINX} now={NOW} />);

    expect(screen.getByRole('heading', { level: 1, name: 'nginx' })).toBeInTheDocument();
    expect(screen.getByText('Official Image')).toBeInTheDocument();
    expect(screen.getByText('Official build of Nginx.')).toBeInTheDocument();
    expect(screen.getByText('10B+')).toBeInTheDocument();
    expect(screen.getByText('21.4K')).toBeInTheDocument();
    const time = container.querySelector('time');
    expect(time).toHaveTextContent('2 days ago');
    expect(time).toHaveAttribute('dateTime', NGINX.updatedAt);
    expect(time?.getAttribute('title')).toMatch(/Oct 31, 2026/);
  });

  it('skips the owner line for official images', () => {
    render(<RepoHeader repo={NGINX} now={NOW} />);
    expect(screen.queryByText(/^by /)).toBeNull();
  });

  it('shows the owner for other repositories, and "Archived" when archived', () => {
    render(
      <RepoHeader
        repo={{
          ...NGINX,
          namespace: 'kernel528',
          owner: 'kernel528',
          badge: 'none',
          archived: true,
        }}
        now={NOW}
      />,
    );
    expect(screen.getByText('by kernel528')).toBeInTheDocument();
    expect(screen.getByText('Archived')).toBeInTheDocument();
    expect(screen.queryByText('Official Image')).toBeNull();
  });

  it('handles a missing description and date', () => {
    const { container } = render(
      <RepoHeader repo={{ ...NGINX, description: ' ', updatedAt: '' }} now={NOW} />,
    );
    expect(screen.getByText('No description')).toBeInTheDocument();
    expect(container.querySelector('time')).toBeNull();
    expect(screen.getByText('Unknown')).toBeInTheDocument();
  });

  it('falls back to the pull count when there is no label', () => {
    render(<RepoHeader repo={{ ...NGINX, pullsLabel: '' }} now={NOW} />);
    expect(screen.getByText('13.5B')).toBeInTheDocument();
  });

  it('lets a very long name wrap instead of widening the page', () => {
    const name = 'a'.repeat(255);
    render(<RepoHeader repo={{ ...NGINX, name, displayName: name }} now={NOW} />);
    expect(screen.getByRole('heading', { level: 1 })).toHaveClass('min-w-0', 'wrap-anywhere');
  });

  it('has a favorite toggle in the title row', () => {
    render(<RepoHeader repo={NGINX} now={NOW} />);

    const toggle = screen.getByRole('button', { name: 'Favorite nginx' });
    fireEvent.click(toggle);

    expect(screen.getByRole('button', { name: 'Favorite nginx' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    // Only the card's fields are kept, not the page's stats.
    expect(JSON.parse(localStorage.getItem(FAVORITES_KEY) ?? '[]')).toEqual([
      {
        id: 'library/nginx',
        namespace: 'library',
        name: 'nginx',
        displayName: 'nginx',
        owner: 'library',
        description: 'Official build of Nginx.',
        logoUrl: 'https://d1q6f0aelx0por.cloudfront.net/product-logos/nginx.png',
        badge: 'official',
      },
    ]);
  });
});
