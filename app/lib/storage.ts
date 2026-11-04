/**
 * Guarded `localStorage` access for small client-side preferences (recent
 * searches, favorites; questionnaire B8).
 *
 * Every call is safe to make anywhere: on the server (no `window`), with
 * storage blocked by the browser (accessing `window.localStorage` throws a
 * `SecurityError`), or with the quota full (`setItem` throws). Failures never
 * throw; callers get `null` / `false` and carry on without persistence.
 */

function getStorage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

/** The stored string, or `null` when missing, on the server, or when storage is unavailable. */
export function readStorage(key: string): string | null {
  try {
    return getStorage()?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

/** Stores `value`; `false` when storage is unavailable or full. */
export function writeStorage(key: string, value: string): boolean {
  const storage = getStorage();
  if (!storage) return false;
  try {
    storage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

/** Removes `key`; `false` when storage is unavailable. */
export function removeStorage(key: string): boolean {
  const storage = getStorage();
  if (!storage) return false;
  try {
    storage.removeItem(key);
    return true;
  } catch {
    return false;
  }
}
