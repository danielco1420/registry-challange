import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

// Initializes the shared i18next instance, as app/root.tsx does in the app.
import '~/i18n/i18next';

import { Loading } from './loading';

describe('Loading', () => {
  it('announces a short default text, with a decorative spinner', () => {
    const { container } = render(<Loading />);

    expect(screen.getByRole('status')).toHaveTextContent('Loading…');
    const spinner = container.querySelector('svg');
    expect(spinner).toHaveAttribute('aria-hidden', 'true');
    expect(spinner).toHaveClass('animate-spin', 'motion-reduce:animate-none');
  });

  it('takes a custom label and extra classes', () => {
    render(<Loading label="Loading tags…" className="py-2" />);

    const status = screen.getByRole('status');
    expect(status).toHaveTextContent('Loading tags…');
    expect(status).toHaveClass('py-2');
  });
});
