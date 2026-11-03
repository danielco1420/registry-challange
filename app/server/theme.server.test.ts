import { describe, expect, it } from 'vitest';

import { readTheme, themeCookieHeader } from './theme.server';

function requestWithCookie(cookie?: string): Request {
  return new Request('http://localhost/', cookie ? { headers: { Cookie: cookie } } : undefined);
}

describe('readTheme', () => {
  it('defaults to System without a cookie', () => {
    expect(readTheme(requestWithCookie())).toBe('system');
  });

  it('reads the theme cookie among others', () => {
    expect(readTheme(requestWithCookie('a=1; theme=dark; b=2'))).toBe('dark');
    expect(readTheme(requestWithCookie('theme=light'))).toBe('light');
  });

  it('ignores cookies whose name only contains "theme"', () => {
    expect(readTheme(requestWithCookie('mytheme=dark; theme_x=light'))).toBe('system');
  });

  it.each(['theme=', 'theme=blue', 'theme=DARK', 'theme'])('falls back to System for %s', (c) => {
    expect(readTheme(requestWithCookie(c))).toBe('system');
  });
});

describe('themeCookieHeader', () => {
  it('stores an explicit choice for a year, HttpOnly and SameSite=Lax', () => {
    expect(themeCookieHeader('dark')).toBe(
      'theme=dark; Max-Age=31536000; Path=/; HttpOnly; SameSite=Lax',
    );
  });

  it('deletes the cookie for System, the default', () => {
    expect(themeCookieHeader('system')).toBe('theme=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax');
  });

  it('round-trips through readTheme', () => {
    const value = themeCookieHeader('light').split(';')[0];
    expect(readTheme(requestWithCookie(value))).toBe('light');
  });
});
