import { describe, expect, it } from 'vitest';

import type { TagOrdering } from './params';
import {
  DEFAULT_TAG_ORDERING,
  TAGS_PAGE_MAX,
  TAGS_PAGE_SIZE,
  isPastAnonymousCap,
  isValidTagFilter,
  nextOrdering,
  nextTagsPage,
  parseTagsUrl,
  sortDirection,
  tagsHref,
  tagsSearch,
} from './tags-query';

const parse = (search: string) => parseTagsUrl(new URLSearchParams(search));

describe('parseTagsUrl', () => {
  it('defaults: newest first, no filter, page 1', () => {
    expect(parse('')).toEqual({ ordering: 'last_updated', name: '', page: 1 });
    expect(DEFAULT_TAG_ORDERING).toBe('last_updated');
  });

  it('reads ordering, a trimmed name and page', () => {
    expect(parse('?ordering=-name&name=%20alpine%20&page=3')).toEqual({
      ordering: '-name',
      name: 'alpine',
      page: 3,
    });
  });

  it.each(['?ordering=size', '?ordering=NAME', '?ordering='])(
    '%s: an unknown ordering falls back to the default',
    (search) => {
      expect(parse(search).ordering).toBe(DEFAULT_TAG_ORDERING);
    },
  );

  it('keeps the first value of a repeated key, and skips empty ones', () => {
    expect(parse('?ordering=name&ordering=-name').ordering).toBe('name');
    expect(parse('?name=&name=alpine').name).toBe('');
  });

  it('keeps a name no tag could have, so the tab can say nothing matches it', () => {
    expect(parse('?name=alp*').name).toBe('alp*');
  });

  it.each(['?page=0', '?page=-1', '?page=abc', '?page=1.5', `?page=${TAGS_PAGE_MAX + 1}`])(
    '%s: an invalid or out-of-range page reads as 1',
    (search) => {
      expect(parse(search).page).toBe(1);
    },
  );

  it('accepts the last page within the anonymous cap', () => {
    expect(TAGS_PAGE_MAX * TAGS_PAGE_SIZE).toBeLessThanOrEqual(1000);
    expect(parse(`?page=${TAGS_PAGE_MAX}`).page).toBe(TAGS_PAGE_MAX);
  });
});

describe('tagsSearch / tagsHref', () => {
  it('leaves defaults out of the URL', () => {
    expect(tagsSearch({ ordering: 'last_updated', name: '' })).toBe('');
    expect(tagsHref('/_/nginx', { ordering: 'last_updated', name: '' })).toBe('/_/nginx/tags');
  });

  it('writes the filter, a non-default ordering and a page after 1', () => {
    expect(tagsSearch({ ordering: '-name', name: 'alpine' }, 2)).toBe(
      '?name=alpine&ordering=-name&page=2',
    );
    expect(tagsHref('/r/fluent/fluent-bit', { ordering: 'last_updated', name: '3.1' })).toBe(
      '/r/fluent/fluent-bit/tags?name=3.1',
    );
  });

  it('round-trips through parseTagsUrl', () => {
    const state = { ordering: '-last_updated' as const, name: 'stable-perl' };
    expect(parse(tagsSearch(state, 4))).toEqual({ ...state, page: 4 });
  });
});

describe('sorting', () => {
  it("maps Docker Hub's reversed orderings to directions", () => {
    // Live: `name` lists Z→A, `last_updated` newest first (docs/API.md).
    expect(sortDirection('name', '-name')).toBe('ascending');
    expect(sortDirection('name', 'name')).toBe('descending');
    expect(sortDirection('last_updated', '-last_updated')).toBe('ascending');
    expect(sortDirection('last_updated', 'last_updated')).toBe('descending');
  });

  it('a column the list is not sorted by has no direction', () => {
    expect(sortDirection('name', 'last_updated')).toBeUndefined();
    expect(sortDirection('last_updated', '-name')).toBeUndefined();
  });

  it.each<[TagOrdering, TagOrdering, TagOrdering]>([
    // [current, after a click on Tag, after a click on Last updated]
    ['last_updated', '-name', '-last_updated'],
    ['-last_updated', '-name', 'last_updated'],
    ['-name', 'name', 'last_updated'],
    ['name', '-name', 'last_updated'],
  ])('from %s: Tag → %s, Last updated → %s', (current, byName, byDate) => {
    expect(nextOrdering('name', current)).toBe(byName);
    expect(nextOrdering('last_updated', current)).toBe(byDate);
  });
});

describe('nextTagsPage', () => {
  const page = (page: number, total: number, items = TAGS_PAGE_SIZE) => ({
    items: Array.from({ length: items }, () => ({}) as never),
    total,
    page,
    pageSize: TAGS_PAGE_SIZE,
  });

  it('asks for the next page while there are more tags', () => {
    expect(nextTagsPage(page(1, 120))).toBe(2);
    expect(nextTagsPage(page(2, 120))).toBe(3);
  });

  it('stops at the last page', () => {
    expect(nextTagsPage(page(3, 120, 20))).toBeNull();
    expect(nextTagsPage(page(1, 50))).toBeNull();
    expect(nextTagsPage(page(1, 7, 7))).toBeNull();
  });

  it('stops on an empty page (past the end)', () => {
    expect(nextTagsPage(page(4, 0, 0))).toBeNull();
  });

  it("stops at Docker Hub's anonymous 1000-result cap (fluent/fluent-bit has 2,189 tags)", () => {
    expect(nextTagsPage(page(1, 2189))).toBe(2);
    expect(nextTagsPage(page(TAGS_PAGE_MAX - 1, 2189))).toBe(TAGS_PAGE_MAX);
    expect(nextTagsPage(page(TAGS_PAGE_MAX, 2189))).toBeNull();
    expect(isPastAnonymousCap(2189)).toBe(true);
    expect(isPastAnonymousCap(1000)).toBe(false);
  });
});

describe('isValidTagFilter', () => {
  it.each(['', 'alpine', '3.1.9', 'stable-perl', 'a_b'])('%j is valid', (name) => {
    expect(isValidTagFilter(name)).toBe(true);
  });

  it.each(['alp*', 'a b', 'ä', '../x', 'x'.repeat(129)])('%j is not', (name) => {
    expect(isValidTagFilter(name)).toBe(false);
  });
});
