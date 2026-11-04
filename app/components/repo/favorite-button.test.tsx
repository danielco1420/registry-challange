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
  it('starts unpressed, labelled "Add", when not favorited', () => {
    render(<FavoriteButton repo={NGINX} />);

    const button = screen.getByRole('button', { name: 'Add nginx to favorites' });
    expect(button).toHaveAttribute('aria-pressed', 'false');
  });

  it('toggles to favorited on click, persisting the repo snapshot', () => {
    render(<FavoriteButton repo={NGINX} />);

    fireEvent.click(screen.getByRole('button', { name: 'Add nginx to favorites' }));

    const button = screen.getByRole('button', { name: 'Remove nginx from favorites' });
    expect(button).toHaveAttribute('aria-pressed', 'true');
    expect(JSON.parse(localStorage.getItem(FAVORITES_KEY) ?? '[]')).toEqual([NGINX]);
  });

  it('toggles back off on a second click, clearing storage', () => {
    render(<FavoriteButton repo={NGINX} />);

    const add = screen.getByRole('button', { name: 'Add nginx to favorites' });
    fireEvent.click(add);
    fireEvent.click(screen.getByRole('button', { name: 'Remove nginx from favorites' }));

    expect(screen.getByRole('button', { name: 'Add nginx to favorites' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    expect(localStorage.getItem(FAVORITES_KEY)).toBeNull();
  });

  it('starts pressed when the repo is already favorited', () => {
    localStorage.setItem(FAVORITES_KEY, JSON.stringify([NGINX]));

    render(<FavoriteButton repo={NGINX} />);

    expect(screen.getByRole('button', { name: 'Remove nginx from favorites' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });
});
