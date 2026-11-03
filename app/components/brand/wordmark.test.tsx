import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

// Initializes the shared i18next instance, as app/root.tsx does in the app.
import '~/i18n/i18next';

import { Wordmark } from './wordmark';

describe('Wordmark', () => {
  it('shows the app name as its accessible text, with a decorative mark', () => {
    const { container } = render(
      <h1>
        <Wordmark />
      </h1>,
    );

    expect(screen.getByRole('heading', { name: "Danny's Dockers" })).toBeInTheDocument();
    const mark = container.querySelector('svg');
    expect(mark).toHaveAttribute('aria-hidden', 'true');
    expect(mark).toHaveClass('fill-primary', 'stroke-brand');
  });

  it('merges extra classes', () => {
    const { container } = render(<Wordmark className="text-2xl" />);
    expect(container.firstChild).toHaveClass('inline-flex', 'text-2xl');
  });
});
