import { useCallback, useSyncExternalStore } from 'react';

import {
  addFavorite,
  FAVORITES_KEY,
  isFavorited,
  type FavoriteRepo,
  parseFavorites,
  removeFavorite,
} from '~/lib/favorites';
import { readStorage, removeStorage, writeStorage } from '~/lib/storage';

/*
 * One small store over `localStorage`, shared by every favorite toggle
 * (`FavoriteButton`, on `RepoCard` and `RepoHeader`) and the Explore
 * favorites section, so starring a repository on its own page shows up in
 * the card grid too. Other tabs are picked up through the `storage` event.
 * When storage is unavailable (blocked, full), the list lives in memory for
 * this page load instead.
 */

const EMPTY: readonly FavoriteRepo[] = [];
const listeners = new Set<() => void>();

/** Set when a write failed: the list we couldn't persist. */
let memoryList: readonly FavoriteRepo[] | null = null;
/** The raw value `cachedList` was parsed from, so snapshots stay referentially stable. */
let cachedRaw: string | null | undefined;
let cachedList: readonly FavoriteRepo[] = EMPTY;

function getSnapshot(): readonly FavoriteRepo[] {
  if (memoryList) return memoryList;
  const raw = readStorage(FAVORITES_KEY);
  if (raw !== cachedRaw) {
    cachedRaw = raw;
    cachedList = parseFavorites(raw);
  }
  return cachedList;
}

/** The server has no storage: SSR and hydration render no favorites. */
function getServerSnapshot(): readonly FavoriteRepo[] {
  return EMPTY;
}

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  const onStorage = (event: StorageEvent) => {
    // `key` is null when another tab cleared all of storage.
    if (event.key !== FAVORITES_KEY && event.key !== null) return;
    // Another tab managed to write, so storage is the truth again: drop our
    // in-memory fallback instead of hiding (and later overwriting) its list.
    memoryList = null;
    onChange();
  };
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener('storage', onStorage);
  };
}

function save(list: readonly FavoriteRepo[]): void {
  const persisted =
    list.length === 0
      ? removeStorage(FAVORITES_KEY)
      : writeStorage(FAVORITES_KEY, JSON.stringify(list));
  memoryList = persisted ? null : list;
  for (const listener of listeners) listener();
}

/** Test hook: forgets the in-memory fallback and parse cache. */
export function resetFavoritesStore(): void {
  memoryList = null;
  cachedRaw = undefined;
  cachedList = EMPTY;
}

export interface Favorites {
  /** Most recently favorited first, at most `MAX_FAVORITES`. Empty during SSR and hydration. */
  favorites: readonly FavoriteRepo[];
  /** Whether `id` (`namespace/name`) is favorited. */
  isFavorite: (id: string) => boolean;
  /** Adds `repo` (just its `FavoriteRepo` fields) if it isn't favorited yet, else removes it. */
  toggle: (repo: FavoriteRepo) => void;
}

export function useFavorites(): Favorites {
  const favorites = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const toggle = useCallback((repo: FavoriteRepo) => {
    const current = getSnapshot();
    save(
      isFavorited(current, repo.id) ? removeFavorite(current, repo.id) : addFavorite(current, repo),
    );
  }, []);
  const isFavorite = useCallback((id: string) => isFavorited(favorites, id), [favorites]);
  return { favorites, isFavorite, toggle };
}
