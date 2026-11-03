import { render, screen } from '@testing-library/react';
import { createRoutesStub } from 'react-router';
import { describe, expect, it } from 'vitest';

// Initializes the shared i18next instance, as app/root.tsx does in the app.
import '~/i18n/i18next';

import { AppShell } from './app-shell';

function renderShell() {
  const Stub = createRoutesStub([
    {
      id: 'root',
      path: '/',
      loader: () => ({ theme: 'system' }),
      Component: () => (
        <AppShell>
          <h1>Page content</h1>
        </AppShell>
      ),
    },
  ]);
  return render(<Stub initialEntries={['/']} />);
}

describe('AppShell', () => {
  it('renders the header, main and footer landmarks around the page', async () => {
    renderShell();
    const main = await screen.findByRole('main');
    expect(main).toHaveAttribute('id', 'main');
    expect(main).toContainElement(screen.getByRole('heading', { name: 'Page content' }));
    expect(screen.getByRole('banner')).toBeInTheDocument();
    expect(screen.getByRole('contentinfo')).toHaveTextContent(/not affiliated with/);
  });

  it('starts with a skip link to the main content', async () => {
    const { container } = renderShell();
    const skip = await screen.findByRole('link', { name: 'Skip to main content' });
    expect(skip).toHaveAttribute('href', '#main');
    // The first focusable element on the page.
    expect(container.querySelector('a, button, input')).toBe(skip);
    // main takes focus from the skip link.
    expect(screen.getByRole('main')).toHaveAttribute('tabindex', '-1');
  });

  it('links the brand home and holds the search slot and theme toggle in the header', async () => {
    renderShell();
    const header = await screen.findByRole('banner');
    expect(screen.getByRole('link', { name: "Danny's Dockers" })).toHaveAttribute('href', '/');
    expect(header.querySelector('[data-slot="header-search"]')).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Color theme' })).toBeInTheDocument();
  });
});
