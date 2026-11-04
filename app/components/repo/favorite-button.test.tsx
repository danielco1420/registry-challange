import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import '~/i18n/i18next';

import { FAVORITES_KEY, type FavoriteRepo } from '~/lib/favorites';

import { FavoriteButton } from './favorite-button';
import { resetFavoritesStore } from './use-favorites';

const NGINX: FavoriteRepo = {
  id: 'library/nginx',
  namespace: 'library',
  name: 'nginx',
  displayName: 'nginx',
  owner: 'library',
  description: 'Official build of Nginx.',
  badge: 'official',
};

beforeEach(() => {
  localStorage.clear();
  resetFavoritesStore();
});

describe('FavoriteButton', () => {
  it('starts unpressed when not favorited', () => {
    render(<FavoriteButton repo={NGINX} />);

    const button = screen.getByRole('button', { name: 'Favorite nginx' });
    expect(button).toHaveAttribute('aria-pressed', 'false');
  });

  it('toggles to favorited on click, keeping the same label and persisting the repo snapshot', () => {
    render(<FavoriteButton repo={NGINX} />);

    const button = screen.getByRole('button', { name: 'Favorite nginx' });
    fireEvent.click(button);

    // Only `aria-pressed` changes; the accessible name stays put.
    expect(button).toHaveAttribute('aria-pressed', 'true');
    expect(button).toHaveAccessibleName('Favorite nginx');
    expect(JSON.parse(localStorage.getItem(FAVORITES_KEY) ?? '[]')).toEqual([NGINX]);
  });

  it('stores only the card fields, not the whole repository it was given', () => {
    const details = { ...NGINX, pulls: 1, fullDescriptionMd: '# A long README', categories: [] };
    render(<FavoriteButton repo={details} />);

    fireEvent.click(screen.getByRole('button', { name: 'Favorite nginx' }));

    expect(JSON.parse(localStorage.getItem(FAVORITES_KEY) ?? '[]')).toEqual([NGINX]);
  });

  it('toggles back off on a second click, clearing storage', () => {
    render(<FavoriteButton repo={NGINX} />);

    const add = screen.getByRole('button', { name: 'Favorite nginx' });
    fireEvent.click(add);
    fireEvent.click(screen.getByRole('button', { name: 'Favorite nginx' }));

    expect(screen.getByRole('button', { name: 'Favorite nginx' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    expect(localStorage.getItem(FAVORITES_KEY)).toBeNull();
  });

  it('starts pressed when the repo is already favorited', () => {
    localStorage.setItem(FAVORITES_KEY, JSON.stringify([NGINX]));

    render(<FavoriteButton repo={NGINX} />);

    expect(screen.getByRole('button', { name: 'Favorite nginx' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });
});
