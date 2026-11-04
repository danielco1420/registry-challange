import { useCallback, useSyncExternalStore } from 'react';

import {
  addRecentSearch,
  normalizeQuery,
  parseRecentSearches,
  RECENT_SEARCHES_KEY,
} from '~/lib/recent-searches';
import { readStorage, removeStorage, writeStorage } from '~/lib/storage';

/*
 * One small store over `localStorage`, shared by every search bar on the page
 * (header and Explore), so adding or clearing in one shows in the other. Other
 * tabs are picked up through the `storage` event. When storage is unavailable
 * (blocked, full), the list lives in memory for this page load instead.
 */

const EMPTY: readonly string[] = [];
const listeners = new Set<() => void>();

/** Set when a write failed: the list we couldn't persist. */
let memoryList: readonly string[] | null = null;
/** The raw value `cachedList` was parsed from, so snapshots stay referentially stable. */
let cachedRaw: string | null | undefined;
let cachedList: readonly string[] = EMPTY;

function getSnapshot(): readonly string[] {
  if (memoryList) return memoryList;
  const raw = readStorage(RECENT_SEARCHES_KEY);
  if (raw !== cachedRaw) {
    cachedRaw = raw;
    cachedList = parseRecentSearches(raw);
  }
  return cachedList;
}

/** The server has no storage: SSR and hydration render no recent searches. */
function getServerSnapshot(): readonly string[] {
  return EMPTY;
}

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  const onStorage = (event: StorageEvent) => {
    // `key` is null when another tab cleared all of storage.
    if (event.key === RECENT_SEARCHES_KEY || event.key === null) onChange();
  };
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener('storage', onStorage);
  };
}

function save(list: readonly string[]): void {
  const persisted =
    list.length === 0
      ? removeStorage(RECENT_SEARCHES_KEY)
      : writeStorage(RECENT_SEARCHES_KEY, JSON.stringify(list));
  memoryList = persisted ? null : list;
  for (const listener of listeners) listener();
}

/** Test hook: forgets the in-memory fallback and parse cache. */
export function resetRecentSearchesStore(): void {
  memoryList = null;
  cachedRaw = undefined;
  cachedList = EMPTY;
}

export interface RecentSearches {
  /** Most recent first, at most `MAX_RECENT_SEARCHES`. Empty during SSR and hydration. */
  searches: readonly string[];
  /** Moves `query` to the front (deduplicated, capped). Blank queries are ignored. */
  add: (query: string) => void;
  clear: () => void;
}

export function useRecentSearches(): RecentSearches {
  const searches = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const add = useCallback((query: string) => {
    if (normalizeQuery(query)) save(addRecentSearch(getSnapshot(), query));
  }, []);
  const clear = useCallback(() => save(EMPTY), []);
  return { searches, add, clear };
}
