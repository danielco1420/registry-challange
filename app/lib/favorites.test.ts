import { describe, expect, it } from 'vitest';

import {
  addFavorite,
  isFavorited,
  MAX_FAVORITES,
  parseFavorites,
  removeFavorite,
} from './favorites';
import type { FavoriteRepo } from './favorites';

function repo(id: string, overrides: Partial<FavoriteRepo> = {}): FavoriteRepo {
  const [namespace = '', name = ''] = id.split('/');
  return {
    id,
    namespace,
    name,
    displayName: namespace === 'library' ? name : id,
    owner: namespace,
    description: '',
    badge: 'none',
    ...overrides,
  };
}

describe('addFavorite', () => {
  it('puts the repo first', () => {
    expect(addFavorite([repo('library/redis')], repo('library/nginx'))).toEqual([
      repo('library/nginx'),
      repo('library/redis'),
    ]);
  });

  it('moves an already-favorited repo to the front instead of duplicating it', () => {
    const list = [repo('library/redis'), repo('library/nginx'), repo('library/node')];
    expect(addFavorite(list, repo('library/nginx'))).toEqual([
      repo('library/nginx'),
      repo('library/redis'),
      repo('library/node'),
    ]);
  });

  it(`keeps at most ${MAX_FAVORITES} entries, dropping the oldest`, () => {
    const full = Array.from({ length: MAX_FAVORITES }, (_, i) => repo(`library/r${i}`));
    const next = addFavorite(full, repo('library/new'));
    expect(next).toHaveLength(MAX_FAVORITES);
    expect(next[0]?.id).toBe('library/new');
    expect(next.some((r) => r.id === `library/r${MAX_FAVORITES - 1}`)).toBe(false);
  });

  it('does not mutate the list it was given', () => {
    const list = [repo('library/redis')];
    addFavorite(list, repo('library/nginx'));
    expect(list).toEqual([repo('library/redis')]);
  });
});

describe('removeFavorite', () => {
  it('drops the matching id and leaves the rest', () => {
    const list = [repo('library/nginx'), repo('library/redis')];
    expect(removeFavorite(list, 'library/nginx')).toEqual([repo('library/redis')]);
  });

  it('is a no-op when the id is not favorited', () => {
    const list = [repo('library/nginx')];
    expect(removeFavorite(list, 'library/redis')).toEqual(list);
  });
});

describe('isFavorited', () => {
  it('finds a matching id', () => {
    expect(isFavorited([repo('library/nginx')], 'library/nginx')).toBe(true);
    expect(isFavorited([repo('library/nginx')], 'library/redis')).toBe(false);
  });
});

describe('parseFavorites', () => {
  it('reads a stored list', () => {
    const list = [repo('library/nginx'), repo('library/redis')];
    expect(parseFavorites(JSON.stringify(list))).toEqual(list);
  });

  it.each([
    ['nothing stored', null],
    ['an empty string', ''],
    ['invalid JSON', '{nope'],
    ['a non-array', '{"0":"nginx"}'],
    ['a string', '"nginx"'],
  ])('returns an empty list for %s', (_label, raw) => {
    expect(parseFavorites(raw)).toEqual([]);
  });

  it('drops entries missing a field, with an unknown badge, or duplicated, and caps the list', () => {
    const raw = JSON.stringify([
      repo('library/nginx'),
      { id: 'library/broken' }, // missing fields
      { ...repo('library/weird'), badge: 'not-a-badge' },
      repo('library/nginx'), // duplicate
      ...Array.from({ length: MAX_FAVORITES }, (_, i) => repo(`library/r${i}`)),
    ]);
    const list = parseFavorites(raw);
    expect(list[0]).toEqual(repo('library/nginx'));
    expect(list).toHaveLength(MAX_FAVORITES);
    expect(list.filter((r) => r.id === 'library/nginx')).toHaveLength(1);
    expect(list.some((r) => r.id === 'library/broken')).toBe(false);
    expect(list.some((r) => r.id === 'library/weird')).toBe(false);
  });
});
