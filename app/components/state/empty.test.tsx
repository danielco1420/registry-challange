import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import '~/i18n/i18next';

import { Button } from '~/components/ui/button';

import { Empty } from './empty';

describe('Empty', () => {
  it('shows the default copy, which names a next action, and the call to action', () => {
    const clearFilters = vi.fn();
    render(<Empty action={<Button onClick={clearFilters}>Clear filters</Button>} />);

    expect(screen.getByRole('heading', { level: 2, name: 'No results' })).toBeInTheDocument();
    expect(screen.getByText('Try a different search, or clear the filters.')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(clearFilters).toHaveBeenCalledOnce();
  });

  it('takes a custom title and description', () => {
    render(
      <Empty
        title="No tags match “alpine”"
        description="Clear the tag filter to see every tag."
        action={<Button>Clear tag filter</Button>}
      />,
    );

    expect(screen.getByRole('heading', { name: 'No tags match “alpine”' })).toBeInTheDocument();
    expect(screen.getByText('Clear the tag filter to see every tag.')).toBeInTheDocument();
  });

  it('renders the title at the given heading level', () => {
    render(<Empty headingLevel={3} action={<Button>Try again</Button>} />);

    expect(screen.getByRole('heading', { level: 3, name: 'No results' })).toBeInTheDocument();
  });
});
