/**
 * Recent searches (questionnaire E28): pure helpers for the list kept in
 * `localStorage` under `RECENT_SEARCHES_KEY`, most recent first. The hook
 * that reads and writes it is `useRecentSearches`.
 */

/** The `localStorage` key. */
export const RECENT_SEARCHES_KEY = 'registry-ui:recent-searches';

/** How many recent searches we keep. */
export const MAX_RECENT_SEARCHES = 8;

/** Same cap as the `q` param schema (`app/lib/params.ts`). */
const MAX_QUERY_LENGTH = 100;

/** Trims and collapses inner whitespace; `''` for a blank query. */
export function normalizeQuery(query: string): string {
  return query.trim().replace(/\s+/g, ' ');
}

/** Case-insensitive duplicates and blanks dropped, first occurrence kept, at most `max` entries. */
function dedupe(queries: readonly string[], max: number): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of queries) {
    const query = normalizeQuery(raw);
    const key = query.toLowerCase();
    if (!query || query.length > MAX_QUERY_LENGTH || seen.has(key)) continue;
    seen.add(key);
    out.push(query);
    if (out.length === max) break;
  }
  return out;
}

/**
 * The list from its stored JSON. Anything malformed (bad JSON, not an array,
 * non-string entries) is dropped rather than trusted: the value may have been
 * written by an older version or edited by hand.
 */
export function parseRecentSearches(raw: string | null): string[] {
  if (!raw) return [];
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(value)) return [];
  return dedupe(
    value.filter((entry): entry is string => typeof entry === 'string'),
    MAX_RECENT_SEARCHES,
  );
}

/** `query` moved (or added) to the front; a blank query leaves the list as is. */
export function addRecentSearch(
  list: readonly string[],
  query: string,
  max = MAX_RECENT_SEARCHES,
): string[] {
  const normalized = normalizeQuery(query);
  if (!normalized || normalized.length > MAX_QUERY_LENGTH) return [...list];
  return dedupe([normalized, ...list], max);
}
