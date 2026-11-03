import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import '~/i18n/i18next';

import { RepoBadge } from './repo-badge';

describe('RepoBadge', () => {
  it.each([
    ['official', 'Official Image'],
    ['verified_publisher', 'Verified Publisher'],
    ['open_source', 'Sponsored OSS'],
    ['hardened', 'Hardened Image'],
  ] as const)('labels %s as "%s"', (badge, label) => {
    render(<RepoBadge badge={badge} />);
    expect(screen.getByText(label)).toHaveAttribute('data-slot', 'badge');
  });

  it('renders nothing for "none"', () => {
    const { container } = render(<RepoBadge badge="none" />);
    expect(container).toBeEmptyDOMElement();
  });
});
