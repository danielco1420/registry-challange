/**
 * Light / Dark / System theme (questionnaire D19, B8). Client-safe helpers;
 * the cookie itself is read and written in `app/server/theme.server.ts`.
 *
 * How the right theme paints without a flash: the root loader reads the cookie,
 * and `<html>` is server-rendered with `class="light"` or `class="dark"` for an
 * explicit choice. System renders no class, and `app/app.css` applies the dark
 * tokens through `@media (prefers-color-scheme: dark)` instead, so the browser
 * picks the theme before any JavaScript runs (and follows OS changes live).
 */
import * as v from 'valibot';

export const THEMES = ['light', 'dark', 'system'] as const;
export type Theme = (typeof THEMES)[number];

export const DEFAULT_THEME: Theme = 'system';

/** Resource route the toggle posts to (`app/routes/theme.ts`). */
export const THEME_ACTION_PATH = '/theme';

/** Shared `useFetcher` key, so the toggle and `<html>` see the same pending submission. */
export const THEME_FETCHER_KEY = 'theme';

export const ThemeSchema = v.picklist(THEMES, `theme must be one of: ${THEMES.join(', ')}`);

/** Body of a toggle submission. `redirectTo` is only sent by the no-JS form. */
export const ThemeFormSchema = v.object({
  theme: ThemeSchema,
  redirectTo: v.optional(v.string()),
});

/** `value` as a `Theme`, or `null` if it isn't one. */
export function parseTheme(value: unknown): Theme | null {
  const result = v.safeParse(ThemeSchema, value);
  return result.success ? result.output : null;
}

/** Class for `<html>`: the explicit choice, or none for System (CSS follows the OS). */
export function themeClassName(theme: Theme): 'light' | 'dark' | undefined {
  return theme === 'system' ? undefined : theme;
}

/**
 * A same-origin path to redirect to after the no-JS form post, or `/`. Rejects
 * anything that could leave the site: absolute URLs, protocol-relative `//host`,
 * `/\host` (browsers treat `\` as `/`) and control characters.
 */
export function safeRedirectPath(value: unknown): string {
  if (typeof value !== 'string') return '/';
  // eslint-disable-next-line no-control-regex -- rejecting control characters is the point
  if (!value.startsWith('/') || /^\/[/\\]/.test(value) || /[\u0000-\u001f\u007f]/.test(value)) {
    return '/';
  }
  return value;
}
