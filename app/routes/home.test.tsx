import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import Home, { meta } from './home';

describe('Home', () => {
  it('renders the page heading', () => {
    render(<Home />);
    expect(screen.getByRole('heading', { level: 1, name: "Danny's Dockers" })).toBeInTheDocument();
  });

  it('sets the document title', () => {
    expect(meta({} as Parameters<typeof meta>[0])).toEqual([{ title: "Danny's Dockers" }]);
  });
});
