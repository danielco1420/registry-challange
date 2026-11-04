import { render, screen } from '@testing-library/react';
import { createRoutesStub } from 'react-router';
import { beforeEach, describe, expect, it } from 'vitest';

import '~/i18n/i18next';

import { FAVORITES_KEY, type FavoriteRepo } from '~/lib/favorites';

import { FavoritesSection } from './favorites-section';
import { resetFavoritesStore } from './use-favorites';
import { clearPublisherAvatarCache } from './use-publisher-avatar';

const NGINX: FavoriteRepo = {
  id: 'library/nginx',
  namespace: 'library',
  name: 'nginx',
  displayName: 'nginx',
  owner: 'library',
  description: 'Official build of Nginx.',
  badge: 'official',
};

function renderSection() {
  const Stub = createRoutesStub([{ path: '/', Component: FavoritesSection }]);
  return render(<Stub initialEntries={['/']} />);
}

beforeEach(() => {
  localStorage.clear();
  resetFavoritesStore();
  clearPublisherAvatarCache();
});

describe('FavoritesSection', () => {
  it('renders nothing when there are no favorites', () => {
    const { container } = renderSection();
    expect(container).toBeEmptyDOMElement();
  });

  it('shows a heading and a card per favorite when there are some', async () => {
    localStorage.setItem(FAVORITES_KEY, JSON.stringify([NGINX]));

    renderSection();

    expect(await screen.findByRole('heading', { name: 'Favorites' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'nginx' })).toHaveAttribute('href', '/_/nginx');
  });
});
