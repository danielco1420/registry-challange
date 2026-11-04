import { describe, expect, it } from 'vitest';

import { safeUrl } from './safe-url';

describe('safeUrl', () => {
  it.each([
    ['https://github.com/nginx/nginx', 'https://github.com/nginx/nginx'],
    ['http://nginx.org/', 'http://nginx.org/'],
    ['  https://example.com/a b  ', 'https://example.com/a%20b'],
    ['mailto:docker@example.com', 'mailto:docker@example.com'],
  ])('keeps the link %j', (input, expected) => {
    expect(safeUrl(input)).toBe(expected);
  });

  it.each([
    'javascript:alert(1)',
    'JaVaScRiPt:alert(1)',
    ' javascript:alert(1)',
    'java\tscript:alert(1)',
    'java\nscript:alert(1)',
    '\u0001javascript:alert(1)',
    'vbscript:msgbox(1)',
    'data:text/html,<script>alert(1)</script>',
    'file:///etc/passwd',
    'ftp://example.com/x',
    // Relative and protocol-relative: they would resolve against our origin.
    '/r/library/nginx',
    'docs/README.md',
    '#usage',
    '//evil.example.com/x',
    '',
  ])('drops the link %j', (input) => {
    expect(safeUrl(input)).toBeNull();
  });

  it('allows only https: for images (the CSP img-src)', () => {
    expect(safeUrl('https://example.com/logo.png', 'image')).toBe('https://example.com/logo.png');
    expect(safeUrl('http://example.com/logo.png', 'image')).toBeNull();
    expect(safeUrl('mailto:a@example.com', 'image')).toBeNull();
    expect(safeUrl('data:image/svg+xml;base64,PHN2Zz4=', 'image')).toBeNull();
    expect(safeUrl('javascript:alert(1)', 'image')).toBeNull();
  });
});
