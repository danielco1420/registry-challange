/**
 * Favorites (questionnaire B8, E28): pure helpers for the list kept in
 * `localStorage` under `FAVORITES_KEY`, most recently favorited first. The
 * hook that reads and writes it is `useFavorites`
 * (`app/components/repo/use-favorites.ts`).
 *
 * We store a small snapshot of the repository (the same fields `RepoCard`
 * needs) rather than just its id, so the Explore favorites section can
 * render the card grid without an extra Docker Hub call. A stale
 * description or logo after an upstream change is an accepted tradeoff.
 */

import { BADGE_VALUES, type RepoSummary } from './dto';

/** The `localStorage` key. */
export const FAVORITES_KEY = 'registry-ui:favorites';

/** How many favorites we keep. */
export const MAX_FAVORITES = 50;

/** The repository fields a favorite keeps; the same ones `RepoCard` renders. */
export type FavoriteRepo = Pick<
  RepoSummary,
  'id' | 'namespace' | 'name' | 'displayName' | 'owner' | 'description' | 'logoUrl' | 'badge'
>;

function isFavoriteRepo(value: unknown): value is FavoriteRepo {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.id === 'string' &&
    v.id.length > 0 &&
    typeof v.namespace === 'string' &&
    typeof v.name === 'string' &&
    typeof v.displayName === 'string' &&
    typeof v.owner === 'string' &&
    typeof v.description === 'string' &&
    (v.logoUrl === undefined || typeof v.logoUrl === 'string') &&
    typeof v.badge === 'string' &&
    (BADGE_VALUES as readonly string[]).includes(v.badge)
  );
}

/** Case-sensitive duplicates by `id` dropped, first occurrence kept, at most `max` entries. */
function dedupe(repos: readonly FavoriteRepo[], max: number): FavoriteRepo[] {
  const seen = new Set<string>();
  const out: FavoriteRepo[] = [];
  for (const repo of repos) {
    if (seen.has(repo.id)) continue;
    seen.add(repo.id);
    out.push(repo);
    if (out.length === max) break;
  }
  return out;
}

/**
 * The list from its stored JSON. Anything malformed (bad JSON, not an array,
 * entries missing a field or with an unknown badge) is dropped rather than
 * trusted: the value may have been written by an older version or edited by
 * hand.
 */
export function parseFavorites(raw: string | null): FavoriteRepo[] {
  if (!raw) return [];
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(value)) return [];
  return dedupe(value.filter(isFavoriteRepo), MAX_FAVORITES);
}

/** `repo` moved (or added) to the front, deduplicated by id and capped. */
export function addFavorite(
  list: readonly FavoriteRepo[],
  repo: FavoriteRepo,
  max = MAX_FAVORITES,
): FavoriteRepo[] {
  return dedupe([repo, ...list], max);
}

/** `list` with `id` removed; unchanged if it wasn't there. */
export function removeFavorite(list: readonly FavoriteRepo[], id: string): FavoriteRepo[] {
  return list.filter((repo) => repo.id !== id);
}

/** Whether `id` is in `list`. */
export function isFavorited(list: readonly FavoriteRepo[], id: string): boolean {
  return list.some((repo) => repo.id === id);
}
