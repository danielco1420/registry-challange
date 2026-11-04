import { describe, expect, it } from 'vitest';

import {
  addRecentSearch,
  MAX_RECENT_SEARCHES,
  normalizeQuery,
  parseRecentSearches,
} from './recent-searches';

describe('normalizeQuery', () => {
  it('trims and collapses whitespace', () => {
    expect(normalizeQuery('  fluent   bit \t')).toBe('fluent bit');
    expect(normalizeQuery('   ')).toBe('');
  });
});

describe('addRecentSearch', () => {
  it('puts the query first', () => {
    expect(addRecentSearch(['redis'], 'nginx')).toEqual(['nginx', 'redis']);
  });

  it('moves a repeated query to the front instead of duplicating it, ignoring case', () => {
    expect(addRecentSearch(['redis', 'Nginx', 'node'], 'nginx')).toEqual([
      'nginx',
      'redis',
      'node',
    ]);
  });

  it('stores the normalized query', () => {
    expect(addRecentSearch([], '  fluent   bit ')).toEqual(['fluent bit']);
  });

  it(`keeps at most ${MAX_RECENT_SEARCHES} entries, dropping the oldest`, () => {
    const full = Array.from({ length: MAX_RECENT_SEARCHES }, (_, i) => `q${i}`);
    const next = addRecentSearch(full, 'new');
    expect(next).toHaveLength(MAX_RECENT_SEARCHES);
    expect(next[0]).toBe('new');
    expect(next).not.toContain(`q${MAX_RECENT_SEARCHES - 1}`);
  });

  it('ignores a blank or over-long query', () => {
    expect(addRecentSearch(['redis'], '   ')).toEqual(['redis']);
    expect(addRecentSearch(['redis'], 'x'.repeat(101))).toEqual(['redis']);
  });

  it('does not mutate the list it was given', () => {
    const list = ['redis'];
    addRecentSearch(list, 'nginx');
    expect(list).toEqual(['redis']);
  });
});

describe('parseRecentSearches', () => {
  it('reads a stored list', () => {
    expect(parseRecentSearches('["nginx","redis"]')).toEqual(['nginx', 'redis']);
  });

  it.each([
    ['nothing stored', null],
    ['an empty string', ''],
    ['invalid JSON', '{nope'],
    ['a non-array', '{"0":"nginx"}'],
    ['a string', '"nginx"'],
  ])('returns an empty list for %s', (_label, raw) => {
    expect(parseRecentSearches(raw)).toEqual([]);
  });

  it('drops non-strings, blanks and duplicates, and caps the list', () => {
    const raw = JSON.stringify([
      'nginx',
      42,
      null,
      ' ',
      'NGINX',
      { q: 'x' },
      ...Array.from({ length: 20 }, (_, i) => `q${i}`),
    ]);
    const list = parseRecentSearches(raw);
    expect(list[0]).toBe('nginx');
    expect(list).toHaveLength(MAX_RECENT_SEARCHES);
    expect(list.filter((q) => q.toLowerCase() === 'nginx')).toHaveLength(1);
  });
});
