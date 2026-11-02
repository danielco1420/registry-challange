/**
 * Validation schemas for every param our routes accept (RISKS.md 2.2 / 2.3, G42).
 *
 * This module is client-safe on purpose: proxy resource routes and loaders use it
 * on the server, and pages use the same schemas to read URL state (B13). It must
 * not import anything from `app/server`.
 *
 * Error messages are fixed strings. They never echo the received value, so a
 * 400 response can't reflect attacker-controlled input back.
 */
import * as v from 'valibot';

// ---------------------------------------------------------------------------
// Limits
// ---------------------------------------------------------------------------

/** Max length of a namespace, repository or publisher name. Docker caps a full image name at 255. */
export const NAME_MAX_LENGTH = 255;
/** Max length of a tag (Docker's own limit: 1 + 127). */
export const TAG_MAX_LENGTH = 128;
/** Max length of the search query, after trimming. */
export const QUERY_MAX_LENGTH = 100;
/** Highest page number we serve. Caps page depth (RISKS.md 2.1, G42). */
export const PAGE_MAX = 100;
/** Largest page size. Docker Hub silently caps `page_size` at 100 anyway. */
export const PAGE_SIZE_MAX = 100;
export const PAGE_SIZE_DEFAULT = 25;

// ---------------------------------------------------------------------------
// Path params
// ---------------------------------------------------------------------------

/** Lowercase alphanumerics separated by single `.`, `_` or `-`. Rejects `/`, `%`, `..`, unicode. */
export const NAME_PATTERN = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/;
/** Docker tag grammar. `\w` without the `u` flag is ASCII-only. */
export const TAG_PATTERN = /^[\w][\w.-]{0,127}$/;

const name = (label: string) =>
  v.pipe(
    v.string(`${label} must be a string`),
    v.maxLength(NAME_MAX_LENGTH, `${label} must be at most ${NAME_MAX_LENGTH} characters`),
    v.regex(
      NAME_PATTERN,
      `${label} must be lowercase letters and digits, separated by single ".", "_" or "-"`,
    ),
  );

export const NamespaceSchema = name('namespace');
export const RepoNameSchema = name('repo');
export const PublisherNameSchema = name('publisher');

export const TagSchema = v.pipe(
  v.string('tag must be a string'),
  v.maxLength(TAG_MAX_LENGTH, `tag must be at most ${TAG_MAX_LENGTH} characters`),
  v.regex(
    TAG_PATTERN,
    'tag must start with a letter, digit or "_" and contain only letters, digits, "_", "." or "-"',
  ),
);

// ---------------------------------------------------------------------------
// Query params
// ---------------------------------------------------------------------------

// eslint-disable-next-line no-control-regex
const NO_CONTROL_CHARS = /^[^\u0000-\u001f\u007f-\u009f]*$/;

/** Free-text search. Unicode is allowed (it's sent as an encoded query value, never as a path). */
export const QuerySchema = v.pipe(
  v.string('q must be a string'),
  v.trim(),
  v.maxLength(QUERY_MAX_LENGTH, `q must be at most ${QUERY_MAX_LENGTH} characters`),
  v.regex(NO_CONTROL_CHARS, 'q must not contain control characters'),
);

/** A positive integer in decimal digits, as it arrives in a query string. */
const positiveIntString = (label: string, max: number) =>
  v.pipe(
    v.string(`${label} must be a string`),
    v.regex(/^[0-9]{1,6}$/, `${label} must be a whole number between 1 and ${max}`),
    v.transform(Number),
    v.minValue(1, `${label} must be a whole number between 1 and ${max}`),
    v.maxValue(max, `${label} must be a whole number between 1 and ${max}`),
  );

export const PageSchema = positiveIntString('page', PAGE_MAX);
export const PageSizeSchema = positiveIntString('pageSize', PAGE_SIZE_MAX);

/** Our search sort values. `relevance` means "omit `sort` upstream". */
export const SEARCH_SORTS = ['relevance', 'pulls', 'stars', 'updated'] as const;
export type SearchSort = (typeof SEARCH_SORTS)[number];
export const SearchSortSchema = v.picklist(
  SEARCH_SORTS,
  `sort must be one of: ${SEARCH_SORTS.join(', ')}`,
);

/** Maps our sort value to `/api/search/v4`'s `sort` (always with `order=desc`). See docs/API.md. */
export const SEARCH_SORT_UPSTREAM: Record<SearchSort, 'pull_count' | 'star_count' | 'updated_at' | undefined> = {
  relevance: undefined,
  pulls: 'pull_count',
  stars: 'star_count',
  updated: 'updated_at',
};

/** Search badge filter; passed upstream as `badges` unchanged. */
export const BADGES = ['official', 'verified_publisher', 'open_source'] as const;
export type BadgeFilter = (typeof BADGES)[number];
export const BadgeSchema = v.picklist(BADGES, `badge must be one of: ${BADGES.join(', ')}`);

/** Tag list ordering; passed upstream as `ordering` unchanged. */
export const TAG_ORDERINGS = ['last_updated', '-last_updated', 'name', '-name'] as const;
export type TagOrdering = (typeof TAG_ORDERINGS)[number];
export const TagOrderingSchema = v.picklist(
  TAG_ORDERINGS,
  `ordering must be one of: ${TAG_ORDERINGS.join(', ')}`,
);

/** Tag name substring filter (upstream `name=`). Same charset as a tag, but any position. */
export const TagFilterSchema = v.pipe(
  v.string('name must be a string'),
  v.trim(),
  v.maxLength(TAG_MAX_LENGTH, `name must be at most ${TAG_MAX_LENGTH} characters`),
  v.regex(/^[\w.-]*$/, 'name may contain only letters, digits, "_", "." or "-"'),
);

// ---------------------------------------------------------------------------
// Per-route schemas
// ---------------------------------------------------------------------------

/** `/api/repos/:ns/:repo` (and the details page). */
export const RepoParamsSchema = v.object({
  ns: NamespaceSchema,
  repo: RepoNameSchema,
});

/** `/r/:ns/:repo/tags/:tag` deep link (C15). */
export const TagParamsSchema = v.object({
  ns: NamespaceSchema,
  repo: RepoNameSchema,
  tag: TagSchema,
});

/** `/api/publishers/:name`. */
export const PublisherParamsSchema = v.object({
  name: PublisherNameSchema,
});

/** `/api/search?q=&page=&pageSize=&sort=&badge=`. Missing params get defaults. */
export const SearchQuerySchema = v.object({
  q: v.optional(QuerySchema, ''),
  page: v.optional(PageSchema, '1'),
  pageSize: v.optional(PageSizeSchema, String(PAGE_SIZE_DEFAULT)),
  sort: v.optional(SearchSortSchema, 'relevance'),
  badge: v.optional(BadgeSchema),
});

/** `/api/repos/:ns/:repo/tags?page=&pageSize=&ordering=&name=`. */
export const TagsQuerySchema = v.object({
  page: v.optional(PageSchema, '1'),
  pageSize: v.optional(PageSizeSchema, String(PAGE_SIZE_DEFAULT)),
  ordering: v.optional(TagOrderingSchema),
  name: v.optional(TagFilterSchema),
});

export type RepoParams = v.InferOutput<typeof RepoParamsSchema>;
export type TagParams = v.InferOutput<typeof TagParamsSchema>;
export type PublisherParams = v.InferOutput<typeof PublisherParamsSchema>;
export type SearchQuery = v.InferOutput<typeof SearchQuerySchema>;
export type TagsQuery = v.InferOutput<typeof TagsQuerySchema>;

/**
 * Turns `URLSearchParams` into a plain object for the query schemas.
 * Takes the first value of a repeated key and drops empty values, so `?sort=`
 * behaves like a missing `sort` and falls back to its default.
 */
export function searchParamsToObject(params: URLSearchParams): Record<string, string> {
  // No prototype, so keys like `__proto__` or `constructor` are plain data.
  const out: Record<string, string> = Object.create(null);
  for (const [key, value] of params) {
    if (value !== '' && !Object.hasOwn(out, key)) out[key] = value;
  }
  return out;
}
