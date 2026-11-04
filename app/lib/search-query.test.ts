import { describe, expect, it } from 'vitest';

import {
  SEARCH_PAGE_MAX,
  SEARCH_PAGE_SIZE,
  cleanQuery,
  hasFilters,
  isPastAnonymousCap,
  lastSearchPage,
  paginationRange,
  parseSearchUrl,
  searchHref,
  toSearchQuery,
} from './search-query';

const parse = (search: string) => parseSearchUrl(new URLSearchParams(search));

describe('parseSearchUrl', () => {
  it('defaults to every result, by relevance, unfiltered, page 1', () => {
    expect(parse('')).toEqual({ q: '', sort: 'relevance', page: 1 });
  });

  it('reads q, sort, badge and page', () => {
    expect(parse('q=nginx&sort=stars&badge=official&page=3')).toEqual({
      q: 'nginx',
      sort: 'stars',
      badge: 'official',
      page: 3,
    });
  });

  it('trims q', () => {
    expect(parse('q=%20%20redis%20').q).toBe('redis');
  });

  it.each([
    ['sort=popular', { sort: 'relevance' }],
    ['sort=PULLS', { sort: 'relevance' }],
    ['page=0', { page: 1 }],
    ['page=-2', { page: 1 }],
    ['page=2.5', { page: 1 }],
    ['page=abc', { page: 1 }],
    [`page=${SEARCH_PAGE_MAX + 1}`, { page: 1 }],
    ['page=999999999', { page: 1 }],
  ])('falls back to the default for an invalid value: %s', (search, expected) => {
    expect(parse(search)).toMatchObject(expected);
  });

  it.each(['hardened', 'none', 'OFFICIAL'])('drops an unknown badge: %s', (badge) => {
    expect(parse(`q=x&badge=${badge}`)).toEqual({ q: 'x', sort: 'relevance', page: 1 });
    expect('badge' in parse(`badge=${badge}`)).toBe(false);
  });

  it('reads the last page under the anonymous cap', () => {
    expect(parse(`page=${SEARCH_PAGE_MAX}`).page).toBe(SEARCH_PAGE_MAX);
    expect(SEARCH_PAGE_MAX * SEARCH_PAGE_SIZE).toBeLessThanOrEqual(1000);
  });

  it('takes the first value of a repeated key, and an empty value as missing', () => {
    expect(parse('sort=stars&sort=pulls&q=a&q=b')).toMatchObject({ sort: 'stars', q: 'a' });
    expect(parse('sort=&badge=&page=&q=')).toEqual({ q: '', sort: 'relevance', page: 1 });
  });

  it('ignores unknown keys', () => {
    expect(parse('q=nginx&pageSize=100&from=900&__proto__=x')).toEqual({
      q: 'nginx',
      sort: 'relevance',
      page: 1,
    });
  });
});

describe('cleanQuery', () => {
  it('keeps a valid query, trimmed', () => {
    expect(cleanQuery(' nginx ')).toBe('nginx');
    expect(cleanQuery('café')).toBe('café');
  });

  it('turns control characters into spaces', () => {
    expect(cleanQuery('ngi\u0000nx\n')).toBe('ngi nx');
  });

  it('cuts an over-long query to 100 characters', () => {
    expect(cleanQuery('a'.repeat(150))).toBe('a'.repeat(100));
  });

  it('never splits a character made of two UTF-16 units', () => {
    const cut = cleanQuery(`${'a'.repeat(99)}😀b`);
    expect(cut).toBe('a'.repeat(99));
  });
});

describe('toSearchQuery', () => {
  it('asks for one page of SEARCH_PAGE_SIZE results', () => {
    expect(toSearchQuery({ q: 'nginx', sort: 'pulls', page: 2 })).toEqual({
      q: 'nginx',
      sort: 'pulls',
      badge: undefined,
      page: 2,
      pageSize: SEARCH_PAGE_SIZE,
    });
  });
});

describe('searchHref', () => {
  it('leaves defaults out', () => {
    expect(searchHref({ q: '', sort: 'relevance' })).toBe('/search');
    expect(searchHref({ q: 'nginx', sort: 'relevance' })).toBe('/search?q=nginx');
    expect(searchHref({ q: 'nginx', sort: 'relevance' }, 1)).toBe('/search?q=nginx');
  });

  it('carries every non-default value', () => {
    expect(searchHref({ q: 'nginx', sort: 'updated', badge: 'verified_publisher' }, 4)).toBe(
      '/search?q=nginx&sort=updated&badge=verified_publisher&page=4',
    );
  });

  it('encodes the query', () => {
    expect(searchHref({ q: 'a&b=c d', sort: 'relevance' })).toBe('/search?q=a%26b%3Dc+d');
  });

  it('round-trips through parseSearchUrl', () => {
    const state = { q: 'node js', sort: 'stars', badge: 'open_source', page: 7 } as const;
    const href = searchHref(state, state.page);
    expect(parse(href.slice(href.indexOf('?') + 1))).toEqual(state);
  });
});

describe('hasFilters', () => {
  it('is true when the sort or a badge differs from the default', () => {
    expect(hasFilters({ q: 'x', sort: 'relevance' })).toBe(false);
    expect(hasFilters({ q: 'x', sort: 'pulls' })).toBe(true);
    expect(hasFilters({ q: 'x', sort: 'relevance', badge: 'official' })).toBe(true);
  });
});

describe('lastSearchPage', () => {
  it.each([
    [0, 1],
    [1, 1],
    [25, 1],
    [26, 2],
    [999, 40],
    [1000, 40],
    [295_913, 40],
  ])('%d results: last page %d', (total, last) => {
    expect(lastSearchPage(total)).toBe(last);
  });

  it('caps by the page size it is given', () => {
    expect(lastSearchPage(5000, 100)).toBe(10);
  });
});

describe('isPastAnonymousCap', () => {
  it('is true only past 1000 results', () => {
    expect(isPastAnonymousCap(1000)).toBe(false);
    expect(isPastAnonymousCap(1001)).toBe(true);
  });
});

describe('paginationRange', () => {
  it.each<[number, number, (number | string)[]]>([
    [1, 1, [1]],
    [1, 0, [1]],
    [1, 2, [1, 2]],
    [2, 5, [1, 2, 3, 4, 5]],
    [1, 7, [1, 2, 'ellipsis-end', 7]],
    [4, 7, [1, 2, 3, 4, 5, 6, 7]],
    [6, 40, [1, 'ellipsis-start', 5, 6, 7, 'ellipsis-end', 40]],
    [40, 40, [1, 'ellipsis-start', 39, 40]],
    [3, 40, [1, 2, 3, 4, 'ellipsis-end', 40]],
    [38, 40, [1, 'ellipsis-start', 37, 38, 39, 40]],
  ])('page %d of %d', (current, last, expected) => {
    expect(paginationRange(current, last)).toEqual(expected);
  });

  it('clamps a current page out of range', () => {
    expect(paginationRange(99, 5)).toEqual([1, 'ellipsis-start', 4, 5]);
  });
});
