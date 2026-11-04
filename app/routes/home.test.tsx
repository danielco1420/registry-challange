import { render, screen } from '@testing-library/react';
import { createRoutesStub } from 'react-router';
import { describe, expect, it } from 'vitest';

import Home, { meta } from './home';

function renderHome() {
  // Home renders the search bar, which needs a router (Form, useNavigate).
  const Stub = createRoutesStub([{ path: '/', Component: Home }]);
  render(<Stub initialEntries={['/']} />);
}

describe('Home', () => {
  it('renders the page heading', async () => {
    renderHome();
    expect(
      await screen.findByRole('heading', { level: 1, name: "Danny's Dockers" }),
    ).toBeInTheDocument();
  });

  it('has the search box', async () => {
    renderHome();
    const search = await screen.findByRole('search', { name: 'Search images' });
    expect(search).toHaveAttribute('action', '/search');
  });

  it('sets the document title', () => {
    expect(meta({} as Parameters<typeof meta>[0])).toEqual([{ title: "Danny's Dockers" }]);
  });
});
