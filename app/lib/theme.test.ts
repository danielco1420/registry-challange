import { describe, expect, it } from 'vitest';

import { parseTheme, safeRedirectPath, themeClassName } from './theme';

describe('parseTheme', () => {
  it.each(['light', 'dark', 'system'] as const)('accepts %s', (value) => {
    expect(parseTheme(value)).toBe(value);
  });

  it.each([undefined, null, '', 'Dark', 'blue', 1, {}])('rejects %j', (value) => {
    expect(parseTheme(value)).toBeNull();
  });
});

describe('themeClassName', () => {
  it('uses the explicit choice as the <html> class', () => {
    expect(themeClassName('light')).toBe('light');
    expect(themeClassName('dark')).toBe('dark');
  });

  it('adds no class for System, so CSS follows the OS', () => {
    expect(themeClassName('system')).toBeUndefined();
  });
});

describe('safeRedirectPath', () => {
  it.each(['/', '/r/library/nginx', '/search?q=nginx&page=2', '/_/nginx#tags'])(
    'keeps the same-origin path %s',
    (path) => {
      expect(safeRedirectPath(path)).toBe(path);
    },
  );

  it.each([
    'https://evil.example/',
    '//evil.example/',
    '/\\evil.example/',
    'javascript:alert(1)',
    'search',
    '',
    '/foo\nSet-Cookie: x=1',
    '/\t/evil.example/',
    // Dot segments that collapse to `//evil.example` once the URL is normalized.
    '/.//evil.example',
    '/%2e//evil.example',
    '/./\\evil.example',
    '/a/..//evil.example',
    undefined,
    42,
  ])('falls back to / for %j', (value) => {
    expect(safeRedirectPath(value)).toBe('/');
  });

  it('percent-encodes non-ASCII, which a Location header cannot carry raw', () => {
    expect(safeRedirectPath('/search?q=日本')).toBe('/search?q=%E6%97%A5%E6%9C%AC');
  });
});
