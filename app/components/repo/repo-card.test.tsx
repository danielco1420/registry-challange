import { render, screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { createRoutesStub } from 'react-router';
import { beforeEach, describe, expect, it } from 'vitest';

import '~/i18n/i18next';

import type { RepoSummary } from '~/lib/dto';

import { server } from '../../../test/msw/server';
import { RepoCard, type RepoCardProps } from './repo-card';
import { clearPublisherAvatarCache } from './use-publisher-avatar';

const NGINX: RepoCardProps['repo'] = {
  namespace: 'library',
  name: 'nginx',
  displayName: 'nginx',
  owner: 'Docker',
  description: 'Official build of Nginx.',
  logoUrl: 'https://d1q6f0aelx0por.cloudfront.net/product-logos/nginx.png',
  badge: 'official',
};

function renderCard(repo: RepoCardProps['repo'], props: Omit<RepoCardProps, 'repo'> = {}) {
  const Stub = createRoutesStub([
    { path: '/', Component: () => <RepoCard repo={repo} {...props} /> },
  ]);
  return render(<Stub initialEntries={['/']} />);
}

beforeEach(() => clearPublisherAvatarCache());

describe('RepoCard', () => {
  it('shows the logo, name, owner, description and badge', async () => {
    const { container } = renderCard(NGINX);

    const card = await screen.findByRole('article');
    expect(within(card).getByRole('heading', { level: 3, name: 'nginx' })).toBeInTheDocument();
    expect(card).toHaveTextContent('by Docker');
    expect(card).toHaveTextContent('Official build of Nginx.');
    expect(within(card).getByText('Official Image')).toBeInTheDocument();
    expect(container.querySelector('img')).toHaveAttribute('src', NGINX.logoUrl);
  });

  it('links to /_/{repo} for an official image, as the card’s only tab stop', async () => {
    renderCard(NGINX);

    const link = await screen.findByRole('link', { name: 'nginx' });
    expect(link).toHaveAttribute('href', '/_/nginx');
    expect(screen.getAllByRole('link')).toHaveLength(1);
    link.focus();
    expect(link).toHaveFocus();
  });

  it('links to /r/{ns}/{repo} and shows the full name for other repositories', async () => {
    renderCard({
      ...NGINX,
      namespace: 'fluent',
      name: 'fluent-bit',
      displayName: 'fluent/fluent-bit',
      owner: 'Fluent',
      badge: 'verified_publisher',
    });

    const link = await screen.findByRole('link', { name: 'fluent/fluent-bit' });
    expect(link).toHaveAttribute('href', '/r/fluent/fluent-bit');
    expect(screen.getByText('Verified Publisher')).toBeInTheDocument();
  });

  it.each(['', '   '])('says "No description" for a description of %j', async (description) => {
    renderCard({ ...NGINX, description });

    expect(await screen.findByText('No description')).toBeInTheDocument();
  });

  it('shows no badge for "none"', async () => {
    renderCard({ ...NGINX, badge: 'none' });

    await screen.findByRole('article');
    expect(screen.queryByText('Official Image')).not.toBeInTheDocument();
  });

  it('falls back to the publisher avatar when there is no logo', async () => {
    const avatar = 'https://www.gravatar.com/avatar/abc';
    server.use(
      http.get('*/api/publishers/:name', () =>
        HttpResponse.json({
          name: 'acme',
          displayName: 'Acme',
          kind: 'user',
          avatarUrl: avatar,
          badge: 'none',
        }),
      ),
    );
    const repo: RepoSummary = {
      id: 'acme/tool',
      namespace: 'acme',
      name: 'tool',
      displayName: 'acme/tool',
      owner: 'acme',
      description: '',
      badge: 'none',
      pulls: 0,
      pullsLabel: '0',
      stars: 0,
      updatedAt: '',
      archs: [],
      archived: false,
    };
    const { container } = renderCard(repo);

    expect(await screen.findByText('T')).toBeInTheDocument();
    await waitFor(() => expect(container.querySelector('img')).toHaveAttribute('src', avatar));
  });

  it('can use an h2 for the name', async () => {
    renderCard(NGINX, { headingLevel: 2 });

    expect(await screen.findByRole('heading', { level: 2, name: 'nginx' })).toBeInTheDocument();
  });
});
