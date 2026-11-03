import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import '~/i18n/i18next';

import { DegradedBanner } from './degraded-banner';

describe('DegradedBanner', () => {
  it('says the data may be stale and offers to try again', () => {
    const retry = vi.fn();
    render(<DegradedBanner retry={retry} />);

    const banner = screen.getByRole('status');
    expect(banner).toHaveTextContent('Showing saved data.');
    expect(banner).toHaveTextContent('Try again in a minute for the latest.');

    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(retry).toHaveBeenCalledOnce();
  });

  it('still names the next action without a retry callback', () => {
    render(<DegradedBanner />);

    expect(screen.getByRole('status')).toHaveTextContent('Try again in a minute');
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});
