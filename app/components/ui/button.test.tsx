import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Button } from './button';

describe('Button', () => {
  it('renders a button with the primary (light green) style and a solid focus ring', () => {
    render(<Button>Pull</Button>);
    const button = screen.getByRole('button', { name: 'Pull' });
    expect(button).toHaveClass('bg-primary', 'text-primary-foreground', 'focus-visible:ring-ring');
  });

  it('applies variants, and lets a className override them', () => {
    render(
      <Button variant="link" className="px-0">
        Docs
      </Button>,
    );
    const button = screen.getByRole('button', { name: 'Docs' });
    expect(button).toHaveClass('text-brand', 'px-0');
    expect(button).not.toHaveClass('px-4');
  });

  it('renders its child instead of a button with asChild', () => {
    render(
      <Button asChild>
        <a href="/">Home</a>
      </Button>,
    );
    expect(screen.getByRole('link', { name: 'Home' })).toHaveClass('bg-primary');
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});
