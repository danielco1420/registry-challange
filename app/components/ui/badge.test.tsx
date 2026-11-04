import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Badge } from './badge';

describe('Badge', () => {
  it('renders a span with the default variant', () => {
    render(<Badge>New</Badge>);
    const badge = screen.getByText('New');
    expect(badge.tagName).toBe('SPAN');
    expect(badge).toHaveAttribute('data-slot', 'badge');
    expect(badge).toHaveClass('bg-primary', 'text-primary-foreground');
  });

  it('applies a variant and extra classes', () => {
    render(
      <Badge variant="outline" className="ml-2">
        Hardened
      </Badge>,
    );
    expect(screen.getByText('Hardened')).toHaveClass('text-foreground', 'ml-2');
  });

  it('renders its child instead with asChild, e.g. a link', () => {
    render(
      <Badge asChild variant="secondary">
        <a href="/search?badge=verified_publisher">Verified</a>
      </Badge>,
    );
    const link = screen.getByRole('link', { name: 'Verified' });
    expect(link).toHaveAttribute('data-slot', 'badge');
    expect(link).toHaveClass('bg-secondary');
  });
});
