import { DEFAULT_THEME, parseTheme, type Theme } from '~/lib/theme';

/**
 * The theme cookie (questionnaire B8). It holds `light` or `dark`; System is
 * the default, so choosing it deletes the cookie.
 *
 * - `HttpOnly`: only the server reads it (the root loader); the browser never needs to.
 * - `SameSite=Lax`, `Path=/`, one year.
 * - Not `Secure`: it's a non-sensitive preference, and it must also work on
 *   plain-HTTP localhost (`pnpm start`, `docker run`).
 */
export const THEME_COOKIE = 'theme';

const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;

/** The theme from a request's `Cookie` header; `system` when absent or invalid. */
export function readTheme(request: Request): Theme {
  const header = request.headers.get('Cookie');
  if (!header) return DEFAULT_THEME;
  for (const pair of header.split(';')) {
    const index = pair.indexOf('=');
    if (index === -1) continue;
    if (pair.slice(0, index).trim() !== THEME_COOKIE) continue;
    return parseTheme(pair.slice(index + 1).trim()) ?? DEFAULT_THEME;
  }
  return DEFAULT_THEME;
}

/** `Set-Cookie` value storing `theme` (or deleting the cookie for System). */
export function themeCookieHeader(theme: Theme): string {
  const attributes = 'Path=/; HttpOnly; SameSite=Lax';
  if (theme === 'system') return `${THEME_COOKIE}=; Max-Age=0; ${attributes}`;
  return `${THEME_COOKIE}=${theme}; Max-Age=${ONE_YEAR_SECONDS}; ${attributes}`;
}
