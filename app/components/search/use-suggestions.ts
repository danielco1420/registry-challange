import { useEffect, useState } from 'react';
import * as v from 'valibot';

import { BADGE_VALUES } from '~/lib/dto';
import { normalizeQuery } from '~/lib/recent-searches';

/** Wait this long after the last keystroke before asking for suggestions (questionnaire B11). */
export const SUGGESTIONS_DEBOUNCE_MS = 250;
/** Shorter queries get no suggestions: they match too much and spend the shared rate limit. */
export const SUGGESTIONS_MIN_LENGTH = 2;
/** Our proxy route (CLAUDE.md hard rule 1). The browser never calls Docker Hub. */
export const SUGGESTIONS_PATH = '/api/search/suggestions';

/**
 * The `RepoSummary` fields a suggestion shows. Checked at runtime, so a broken
 * response becomes the error state rather than a crash; unknown fields are
 * dropped, and an unknown badge falls back to `none`.
 */
const SuggestionSchema = v.object({
  id: v.string(),
  namespace: v.string(),
  name: v.string(),
  displayName: v.string(),
  owner: v.string(),
  description: v.string(),
  badge: v.fallback(v.picklist(BADGE_VALUES), 'none'),
});
const SuggestionsResponseSchema = v.object({ items: v.array(SuggestionSchema) });

export type Suggestion = v.InferOutput<typeof SuggestionSchema>;

export interface SuggestionsState {
  /**
   * `idle`: no query long enough to ask for. `loading`: waiting for the
   * debounce or the response. `error`: the request failed (network,
   * `4xx`/`5xx`, unexpected body); the search box keeps working.
   */
  status: 'idle' | 'loading' | 'success' | 'error';
  /** Empty unless `status` is `success`. */
  items: readonly Suggestion[];
}

const NONE: readonly Suggestion[] = [];

async function fetchSuggestions(query: string, signal: AbortSignal): Promise<Suggestion[]> {
  const url = new URL(SUGGESTIONS_PATH, window.location.origin);
  url.searchParams.set('q', query);
  const response = await fetch(url, { signal, headers: { Accept: 'application/json' } });
  if (!response.ok) throw new Error(`Suggestions request failed: HTTP ${response.status}`);
  return v.parse(SuggestionsResponseSchema, await response.json()).items;
}

/** `value`, once it has stopped changing for `delayMs`. */
function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);
  return debounced;
}

/**
 * Autocomplete suggestions for `query` from `GET /api/search/suggestions`,
 * debounced by `SUGGESTIONS_DEBOUNCE_MS`. Pass `''` to stop asking.
 *
 * Stale responses never win (RISKS.md 4.5): each request has its own
 * `AbortController`, aborted as soon as the query changes or the component
 * unmounts, and a response that still lands after that is dropped. Results
 * are also tagged with their query, so only the one for the current query is
 * ever shown.
 *
 * Plain `fetch` rather than `useFetcher`: React Router sends a fetcher's
 * error (a `429` or `503` from the proxy) to the nearest route ErrorBoundary,
 * which would swap the whole page for an error page. Suggestions are
 * optional, so they fail soft into the `error` state instead.
 */
export function useSuggestions(
  query: string,
  { debounceMs = SUGGESTIONS_DEBOUNCE_MS }: { debounceMs?: number } = {},
): SuggestionsState {
  const normalized = normalizeQuery(query);
  const wanted = normalized.length >= SUGGESTIONS_MIN_LENGTH ? normalized : '';
  const debounced = useDebouncedValue(wanted, debounceMs);
  const [result, setResult] = useState<{
    query: string;
    status: 'success' | 'error';
    items: readonly Suggestion[];
  } | null>(null);

  useEffect(() => {
    if (!debounced) return;
    const controller = new AbortController();
    fetchSuggestions(debounced, controller.signal).then(
      (items) => {
        // Settled after the query moved on: a newer request owns the UI now.
        if (controller.signal.aborted) return;
        setResult({ query: debounced, status: 'success', items });
      },
      () => {
        if (controller.signal.aborted) return;
        setResult({ query: debounced, status: 'error', items: NONE });
      },
    );
    return () => controller.abort();
  }, [debounced]);

  if (!wanted) return { status: 'idle', items: NONE };
  if (result && result.query === wanted && wanted === debounced) {
    return { status: result.status, items: result.items };
  }
  return { status: 'loading', items: NONE };
}
