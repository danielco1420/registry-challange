import { act, renderHook, waitFor } from '@testing-library/react';
import { hydrateRoot, type Root } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { FAVORITES_KEY } from '~/lib/favorites';

import { resetFavoritesStore, useFavorites } from './use-favorites';

const NGINX = {
  id: 'library/nginx',
  namespace: 'library',
  name: 'nginx',
  displayName: 'nginx',
  owner: 'library',
  description: 'Official build of Nginx.',
  badge: 'official' as const,
};

const REDIS = { ...NGINX, id: 'library/redis', name: 'redis', displayName: 'redis' };

beforeEach(() => {
  localStorage.clear();
  resetFavoritesStore();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('useFavorites', () => {
  it('starts empty and reflects what is already stored', () => {
    const { result: empty } = renderHook(() => useFavorites());
    expect(empty.current.favorites).toEqual([]);

    localStorage.setItem(FAVORITES_KEY, JSON.stringify([NGINX]));
    resetFavoritesStore();
    const { result } = renderHook(() => useFavorites());
    expect(result.current.favorites).toEqual([NGINX]);
    expect(result.current.isFavorite('library/nginx')).toBe(true);
    expect(result.current.isFavorite('library/redis')).toBe(false);
  });

  it('toggle adds then removes, most recent first, and persists', () => {
    const { result } = renderHook(() => useFavorites());

    act(() => result.current.toggle(NGINX));
    expect(result.current.favorites).toEqual([NGINX]);
    expect(JSON.parse(localStorage.getItem(FAVORITES_KEY) ?? '[]')).toEqual([NGINX]);

    act(() => result.current.toggle(REDIS));
    expect(result.current.favorites).toEqual([REDIS, NGINX]);

    act(() => result.current.toggle(NGINX));
    expect(result.current.favorites).toEqual([REDIS]);
    expect(result.current.isFavorite('library/nginx')).toBe(false);
  });

  it('clears the stored key once the list is empty again', () => {
    const { result } = renderHook(() => useFavorites());
    act(() => result.current.toggle(NGINX));
    act(() => result.current.toggle(NGINX));
    expect(localStorage.getItem(FAVORITES_KEY)).toBeNull();
  });

  it('syncs across tabs via the storage event', async () => {
    const { result } = renderHook(() => useFavorites());
    expect(result.current.favorites).toEqual([]);

    // Another tab writes and dispatches a `storage` event (jsdom doesn't do
    // this automatically for same-document writes).
    localStorage.setItem(FAVORITES_KEY, JSON.stringify([NGINX]));
    act(() => {
      window.dispatchEvent(new StorageEvent('storage', { key: FAVORITES_KEY }));
    });

    await waitFor(() => expect(result.current.favorites).toEqual([NGINX]));
  });

  it('renders no favorites on the server and hydrates without a mismatch', async () => {
    localStorage.setItem(FAVORITES_KEY, JSON.stringify([NGINX]));
    function Probe() {
      const { favorites } = useFavorites();
      return <p>{favorites.map((repo) => repo.id).join(',') || 'none'}</p>;
    }

    const container = document.createElement('div');
    container.innerHTML = renderToString(<Probe />);
    expect(container.textContent).toBe('none');

    const onRecoverableError = vi.fn();
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    let root: Root | undefined;
    await act(async () => {
      root = hydrateRoot(container, <Probe />, { onRecoverableError });
    });

    // The first client paint matched the server; the stored list came right after.
    expect(onRecoverableError).not.toHaveBeenCalled();
    expect(consoleError).not.toHaveBeenCalled();
    expect(container.textContent).toBe('library/nginx');
    act(() => root?.unmount());
  });

  it('drops its in-memory fallback when another tab writes the list', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('Quota exceeded', 'QuotaExceededError');
    });
    const { result } = renderHook(() => useFavorites());
    act(() => result.current.toggle(NGINX));
    expect(result.current.favorites).toEqual([NGINX]);

    // Another tab, with room to spare, stores its own list.
    vi.restoreAllMocks();
    localStorage.setItem(FAVORITES_KEY, JSON.stringify([REDIS]));
    act(() => {
      window.dispatchEvent(new StorageEvent('storage', { key: FAVORITES_KEY }));
    });

    expect(result.current.favorites).toEqual([REDIS]);
  });

  it('still works for this page when storage is blocked, falling back to memory', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('The operation is insecure.', 'SecurityError');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('The operation is insecure.', 'SecurityError');
    });
    resetFavoritesStore();

    const { result } = renderHook(() => useFavorites());
    act(() => result.current.toggle(NGINX));
    expect(result.current.favorites).toEqual([NGINX]);
    expect(result.current.isFavorite('library/nginx')).toBe(true);
  });
});
