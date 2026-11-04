import { afterEach, describe, expect, it, vi } from 'vitest';

import { readStorage, removeStorage, writeStorage } from './storage';

/** A minimal in-memory `Storage`. */
function memoryStorage(): Storage {
  const data = new Map<string, string>();
  return {
    get length() {
      return data.size;
    },
    clear: () => data.clear(),
    getItem: (key) => data.get(key) ?? null,
    key: (index) => [...data.keys()][index] ?? null,
    removeItem: (key) => void data.delete(key),
    setItem: (key, value) => void data.set(key, String(value)),
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('storage helpers', () => {
  it('read, write and remove through localStorage', () => {
    vi.stubGlobal('window', { localStorage: memoryStorage() });
    expect(readStorage('k')).toBeNull();
    expect(writeStorage('k', 'v')).toBe(true);
    expect(readStorage('k')).toBe('v');
    expect(removeStorage('k')).toBe(true);
    expect(readStorage('k')).toBeNull();
  });

  it('do nothing on the server (no window)', () => {
    // The node test project has no `window`, like SSR.
    expect(typeof window).toBe('undefined');
    expect(readStorage('k')).toBeNull();
    expect(writeStorage('k', 'v')).toBe(false);
    expect(removeStorage('k')).toBe(false);
  });

  it('survive storage blocked by the browser (accessing localStorage throws)', () => {
    const blocked = {};
    Object.defineProperty(blocked, 'localStorage', {
      get() {
        throw new DOMException('The operation is insecure.', 'SecurityError');
      },
    });
    vi.stubGlobal('window', blocked);
    expect(readStorage('k')).toBeNull();
    expect(writeStorage('k', 'v')).toBe(false);
    expect(removeStorage('k')).toBe(false);
  });

  it('report a full quota as a failed write', () => {
    const storage = memoryStorage();
    storage.setItem = () => {
      throw new DOMException('Quota exceeded', 'QuotaExceededError');
    };
    storage.getItem = () => {
      throw new Error('broken');
    };
    storage.removeItem = () => {
      throw new Error('broken');
    };
    vi.stubGlobal('window', { localStorage: storage });
    expect(writeStorage('k', 'v')).toBe(false);
    expect(readStorage('k')).toBeNull();
    expect(removeStorage('k')).toBe(false);
  });
});
