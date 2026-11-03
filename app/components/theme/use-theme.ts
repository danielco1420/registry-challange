import { useFetcher, useRouteLoaderData } from 'react-router';

import { DEFAULT_THEME, parseTheme, THEME_FETCHER_KEY, type Theme } from '~/lib/theme';
import type { loader as rootLoader } from '~/root';

/**
 * The current theme choice: a pending toggle submission if there is one
 * (optimistic), else the root loader's value from the cookie, else System.
 * Works in `Layout`, where loader data is missing on error pages.
 */
export function useTheme(): Theme {
  const data = useRouteLoaderData<typeof rootLoader>('root');
  const fetcher = useFetcher({ key: THEME_FETCHER_KEY });
  return parseTheme(fetcher.formData?.get('theme')) ?? data?.theme ?? DEFAULT_THEME;
}
