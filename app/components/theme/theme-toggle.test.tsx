import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { createRoutesStub } from 'react-router';
import { describe, expect, it } from 'vitest';

// Initializes the shared i18next instance, as app/root.tsx does in the app.
import '~/i18n/i18next';
import { parseTheme, type Theme } from '~/lib/theme';

import { ThemeToggle } from './theme-toggle';

/**
 * Renders the toggle under a stub `root` route whose loader plays the theme
 * cookie, next to a stub `/theme` action that records what was submitted.
 */
function renderToggle(initial: Theme, path = '/') {
  let cookie: Theme = initial;
  const submitted: Theme[] = [];
  const Stub = createRoutesStub([
    {
      id: 'root',
      path: '/*',
      loader: () => ({ theme: cookie }),
      Component: () => <ThemeToggle />,
    },
    {
      path: '/theme',
      action: async ({ request }) => {
        const theme = parseTheme((await request.formData()).get('theme'));
        if (!theme) throw new Error('invalid theme submitted');
        submitted.push(theme);
        cookie = theme;
        return { theme };
      },
    },
  ]);
  render(<Stub initialEntries={[path]} />);
  return { submitted };
}

async function findGroup() {
  return screen.findByRole('group', { name: 'Color theme' });
}

function pressedStates(group: HTMLElement) {
  return Object.fromEntries(
    within(group)
      .getAllByRole('button')
      .map((button) => [button.textContent, button.getAttribute('aria-pressed')]),
  );
}

describe('ThemeToggle', () => {
  it('offers Light, Dark and System, with System pressed by default', async () => {
    renderToggle('system');
    const group = await findGroup();
    expect(pressedStates(group)).toEqual({ Light: 'false', Dark: 'false', System: 'true' });
  });

  it('shows the theme from the cookie as pressed', async () => {
    renderToggle('dark');
    expect(pressedStates(await findGroup())).toEqual({
      Light: 'false',
      Dark: 'true',
      System: 'false',
    });
  });

  it('submits the chosen theme to /theme and presses it', async () => {
    const { submitted } = renderToggle('system');
    const group = await findGroup();

    fireEvent.click(within(group).getByRole('button', { name: 'Dark' }));

    await waitFor(() => expect(submitted).toEqual(['dark']));
    await waitFor(() =>
      expect(pressedStates(group)).toEqual({ Light: 'false', Dark: 'true', System: 'false' }),
    );

    fireEvent.click(within(group).getByRole('button', { name: 'Light' }));
    await waitFor(() => expect(submitted).toEqual(['dark', 'light']));
    await waitFor(() =>
      expect(pressedStates(group)).toMatchObject({ Light: 'true', Dark: 'false' }),
    );
  });

  it("doesn't resubmit the theme that's already chosen", async () => {
    const { submitted } = renderToggle('light');
    const group = await findGroup();
    fireEvent.click(within(group).getByRole('button', { name: 'Light' }));
    // Give a submission the chance to happen before asserting that none did.
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(submitted).toEqual([]);
  });

  it('works without JavaScript as a plain form posting back to the current page', async () => {
    renderToggle('system', '/r/library/nginx?tab=tags');
    const group = await findGroup();
    const form = group.closest('form');
    expect(form).toHaveAttribute('method', 'post');
    expect(form).toHaveAttribute('action', '/theme');
    expect(form?.querySelector('input[type="hidden"][name="redirectTo"]')).toHaveValue(
      '/r/library/nginx?tab=tags',
    );
    for (const button of within(group).getAllByRole('button')) {
      expect(button).toHaveAttribute('type', 'submit');
      expect(button).toHaveAttribute('name', 'theme');
    }
    expect(within(group).getByRole('button', { name: 'Dark' })).toHaveAttribute('value', 'dark');
  });
});
