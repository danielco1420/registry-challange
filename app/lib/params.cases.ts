/**
 * Table-driven cases for `params.ts`. Not imported by the app.
 *
 * Ready for Vitest (#5):
 *
 *   it.each(PARAM_CASES)('$schema: $label', ({ schema, input, valid, output }) => {
 *     const result = v.safeParse(PARAM_SCHEMAS[schema], input);
 *     expect(result.success).toBe(valid);
 *     if (valid && output !== undefined) expect(result.output).toEqual(output);
 *   });
 */
import {
  BadgeSchema,
  NamespaceSchema,
  PageSchema,
  PageSizeSchema,
  PublisherNameSchema,
  PublisherParamsSchema,
  QuerySchema,
  RepoNameSchema,
  RepoParamsSchema,
  SearchQuerySchema,
  SearchSortSchema,
  TagFilterSchema,
  TagOrderingSchema,
  TagParamsSchema,
  TagSchema,
  TagsQuerySchema,
} from './params';

export const PARAM_SCHEMAS = {
  namespace: NamespaceSchema,
  repo: RepoNameSchema,
  publisher: PublisherNameSchema,
  tag: TagSchema,
  q: QuerySchema,
  page: PageSchema,
  pageSize: PageSizeSchema,
  sort: SearchSortSchema,
  badge: BadgeSchema,
  ordering: TagOrderingSchema,
  tagFilter: TagFilterSchema,
  repoParams: RepoParamsSchema,
  tagParams: TagParamsSchema,
  publisherParams: PublisherParamsSchema,
  searchQuery: SearchQuerySchema,
  tagsQuery: TagsQuerySchema,
} as const;

export interface ParamCase {
  schema: keyof typeof PARAM_SCHEMAS;
  label: string;
  input: unknown;
  valid: boolean;
  /** Expected output when it differs from the input or matters (defaults, trimming, numbers). */
  output?: unknown;
}

const nameCases = (schema: 'namespace' | 'repo' | 'publisher'): ParamCase[] => [
  { schema, label: 'simple', input: 'nginx', valid: true },
  { schema, label: 'library', input: 'library', valid: true },
  { schema, label: 'separators', input: 'fluent-bit.v2_x', valid: true },
  { schema, label: 'digits only', input: '1234', valid: true },
  { schema, label: 'single char', input: 'a', valid: true },
  { schema, label: 'max length', input: 'a'.repeat(255), valid: true },
  { schema, label: 'empty', input: '', valid: false },
  { schema, label: 'over max length', input: 'a'.repeat(256), valid: false },
  { schema, label: 'huge string', input: 'a'.repeat(100_000), valid: false },
  { schema, label: 'uppercase', input: 'Nginx', valid: false },
  { schema, label: 'parent dir', input: '..', valid: false },
  { schema, label: 'dot-dot-slash', input: '../etc', valid: false },
  { schema, label: 'dot-dot-slash prefix', input: '../../v2/users', valid: false },
  { schema, label: 'double separator', input: 'a..b', valid: false },
  { schema, label: 'leading separator', input: '-nginx', valid: false },
  { schema, label: 'trailing separator', input: 'nginx.', valid: false },
  { schema, label: 'slash', input: 'library/nginx', valid: false },
  { schema, label: 'backslash', input: 'a\\b', valid: false },
  { schema, label: 'encoded slash', input: 'a%2Fb', valid: false },
  { schema, label: 'encoded slash lowercase', input: 'a%2fb', valid: false },
  { schema, label: 'encoded dot-dot-slash', input: '..%2F..%2Fetc', valid: false },
  { schema, label: 'double-encoded slash', input: 'a%252Fb', valid: false },
  { schema, label: 'query injection', input: 'nginx?page_size=1000', valid: false },
  { schema, label: 'fragment', input: 'nginx#x', valid: false },
  { schema, label: 'url', input: 'https://evil.example', valid: false },
  { schema, label: 'space', input: 'ng inx', valid: false },
  { schema, label: 'leading whitespace', input: ' nginx', valid: false },
  { schema, label: 'NUL byte', input: 'nginx\u0000', valid: false },
  { schema, label: 'newline', input: 'nginx\n', valid: false },
  { schema, label: 'unicode letter', input: 'nginé', valid: false },
  { schema, label: 'cyrillic homoglyph', input: 'nginх', valid: false },
  { schema, label: 'fullwidth solidus', input: 'a／b', valid: false },
  { schema, label: 'emoji', input: '🐳', valid: false },
  { schema, label: 'number', input: 42, valid: false },
  { schema, label: 'undefined', input: undefined, valid: false },
  { schema, label: 'array', input: ['nginx'], valid: false },
];

export const PARAM_CASES: ParamCase[] = [
  ...nameCases('namespace'),
  ...nameCases('repo'),
  ...nameCases('publisher'),

  { schema: 'tag', label: 'latest', input: 'latest', valid: true },
  { schema: 'tag', label: 'semver with suffix', input: '1.27.2-alpine3.20', valid: true },
  { schema: 'tag', label: 'uppercase allowed', input: 'V1_RC', valid: true },
  { schema: 'tag', label: 'leading underscore', input: '_internal', valid: true },
  { schema: 'tag', label: 'max length 128', input: 'a'.repeat(128), valid: true },
  { schema: 'tag', label: 'over max length', input: 'a'.repeat(129), valid: false },
  { schema: 'tag', label: 'huge string', input: 'a'.repeat(100_000), valid: false },
  { schema: 'tag', label: 'empty', input: '', valid: false },
  { schema: 'tag', label: 'leading dot', input: '.hidden', valid: false },
  { schema: 'tag', label: 'leading dash', input: '-x', valid: false },
  { schema: 'tag', label: 'dot-dot', input: '..', valid: false },
  { schema: 'tag', label: 'dot-dot-slash', input: '../latest', valid: false },
  { schema: 'tag', label: 'slash', input: 'a/b', valid: false },
  { schema: 'tag', label: 'encoded slash', input: 'a%2Fb', valid: false },
  { schema: 'tag', label: 'colon', input: 'nginx:latest', valid: false },
  { schema: 'tag', label: 'at digest', input: 'x@sha256:abc', valid: false },
  { schema: 'tag', label: 'unicode letter', input: 'lätest', valid: false },
  { schema: 'tag', label: 'NUL byte', input: 'latest\u0000', valid: false },
  { schema: 'tag', label: 'trailing newline', input: 'latest\n', valid: false },

  { schema: 'q', label: 'empty (browse mode)', input: '', valid: true, output: '' },
  { schema: 'q', label: 'trimmed', input: '  nginx  ', valid: true, output: 'nginx' },
  { schema: 'q', label: 'unicode', input: 'base de données 日本 🐳', valid: true },
  {
    schema: 'q',
    label: 'slashes are fine in a query value',
    input: '../library/nginx',
    valid: true,
  },
  { schema: 'q', label: 'max length', input: 'a'.repeat(100), valid: true },
  { schema: 'q', label: 'max length after trim', input: ` ${'a'.repeat(100)} `, valid: true },
  { schema: 'q', label: 'over max length', input: 'a'.repeat(101), valid: false },
  { schema: 'q', label: 'huge string', input: 'a'.repeat(100_000), valid: false },
  { schema: 'q', label: 'NUL byte', input: 'ng\u0000inx', valid: false },
  { schema: 'q', label: 'C1 control', input: 'ng\u0085inx', valid: false },
  { schema: 'q', label: 'inner newline', input: 'a\nb', valid: false },

  { schema: 'page', label: '1', input: '1', valid: true, output: 1 },
  { schema: 'page', label: 'max', input: '100', valid: true, output: 100 },
  { schema: 'page', label: 'leading zeros', input: '007', valid: true, output: 7 },
  { schema: 'page', label: 'zero', input: '0', valid: false },
  { schema: 'page', label: 'over max', input: '101', valid: false },
  { schema: 'page', label: 'huge', input: '99999999999999999999', valid: false },
  { schema: 'page', label: 'negative', input: '-1', valid: false },
  { schema: 'page', label: 'decimal', input: '1.5', valid: false },
  { schema: 'page', label: 'exponent', input: '1e2', valid: false },
  { schema: 'page', label: 'hex', input: '0x10', valid: false },
  { schema: 'page', label: 'whitespace', input: ' 2', valid: false },
  { schema: 'page', label: 'NaN', input: 'NaN', valid: false },
  { schema: 'page', label: 'Infinity', input: 'Infinity', valid: false },
  { schema: 'page', label: 'fullwidth digit', input: '２', valid: false },
  { schema: 'page', label: 'number type', input: 2, valid: false },

  { schema: 'pageSize', label: '25', input: '25', valid: true, output: 25 },
  { schema: 'pageSize', label: 'max', input: '100', valid: true, output: 100 },
  { schema: 'pageSize', label: 'over max', input: '101', valid: false },
  { schema: 'pageSize', label: 'zero', input: '0', valid: false },
  { schema: 'pageSize', label: 'huge', input: '1000000', valid: false },

  { schema: 'sort', label: 'pulls', input: 'pulls', valid: true },
  { schema: 'sort', label: 'relevance', input: 'relevance', valid: true },
  { schema: 'sort', label: 'upstream name', input: 'pull_count', valid: false },
  { schema: 'sort', label: 'wrong case', input: 'Pulls', valid: false },
  { schema: 'sort', label: 'prototype key', input: '__proto__', valid: false },

  { schema: 'badge', label: 'official', input: 'official', valid: true },
  { schema: 'badge', label: 'verified_publisher', input: 'verified_publisher', valid: true },
  { schema: 'badge', label: 'open_source', input: 'open_source', valid: true },
  { schema: 'badge', label: 'none is not a filter', input: 'none', valid: false },
  { schema: 'badge', label: 'list', input: 'official,open_source', valid: false },

  { schema: 'ordering', label: '-last_updated', input: '-last_updated', valid: true },
  { schema: 'ordering', label: 'name', input: 'name', valid: true },
  { schema: 'ordering', label: 'unknown field', input: 'full_size', valid: false },
  { schema: 'ordering', label: 'injection', input: 'name&page_size=1000', valid: false },

  { schema: 'tagFilter', label: 'alpine', input: 'alpine', valid: true },
  { schema: 'tagFilter', label: 'empty', input: '', valid: true },
  { schema: 'tagFilter', label: 'leading dot ok for substring', input: '.20', valid: true },
  { schema: 'tagFilter', label: 'slash', input: 'a/b', valid: false },
  { schema: 'tagFilter', label: 'ampersand', input: 'a&page_size=1000', valid: false },
  { schema: 'tagFilter', label: 'unicode', input: 'älpine', valid: false },
  { schema: 'tagFilter', label: 'over max length', input: 'a'.repeat(129), valid: false },

  {
    schema: 'repoParams',
    label: 'official image',
    input: { ns: 'library', repo: 'nginx' },
    valid: true,
  },
  { schema: 'repoParams', label: 'missing repo', input: { ns: 'library' }, valid: false },
  {
    schema: 'repoParams',
    label: 'traversal in repo',
    input: { ns: 'library', repo: '..' },
    valid: false,
  },

  { schema: 'repoParams', label: 'not an object', input: 'library/nginx', valid: false },

  {
    schema: 'tagParams',
    label: 'deep link',
    input: { ns: 'library', repo: 'nginx', tag: '1.27-alpine' },
    valid: true,
  },
  {
    schema: 'tagParams',
    label: 'traversal in tag',
    input: { ns: 'library', repo: 'nginx', tag: '..' },
    valid: false,
  },
  {
    schema: 'tagParams',
    label: 'missing tag',
    input: { ns: 'library', repo: 'nginx' },
    valid: false,
  },

  { schema: 'publisherParams', label: 'publisher', input: { name: 'bitnami' }, valid: true },
  { schema: 'publisherParams', label: 'encoded slash', input: { name: 'a%2Fb' }, valid: false },

  {
    schema: 'searchQuery',
    label: 'all defaults',
    input: {},
    valid: true,
    output: { q: '', page: 1, pageSize: 25, sort: 'relevance' },
  },
  {
    schema: 'searchQuery',
    label: 'full',
    input: { q: ' redis ', page: '3', pageSize: '50', sort: 'stars', badge: 'official' },
    valid: true,
    output: { q: 'redis', page: 3, pageSize: 50, sort: 'stars', badge: 'official' },
  },
  {
    schema: 'searchQuery',
    label: 'unknown keys are dropped',
    input: { q: 'x', url: 'https://evil.example', path: '../../' },
    valid: true,
    output: { q: 'x', page: 1, pageSize: 25, sort: 'relevance' },
  },
  { schema: 'searchQuery', label: 'bad page', input: { page: '0' }, valid: false },
  { schema: 'searchQuery', label: 'bad badge', input: { badge: 'hardened' }, valid: false },

  {
    schema: 'tagsQuery',
    label: 'all defaults',
    input: {},
    valid: true,
    output: { page: 1, pageSize: 25 },
  },
  {
    schema: 'tagsQuery',
    label: 'full',
    input: { page: '2', pageSize: '100', ordering: 'name', name: 'alpine' },
    valid: true,
    output: { page: 2, pageSize: 100, ordering: 'name', name: 'alpine' },
  },
  { schema: 'tagsQuery', label: 'pageSize over cap', input: { pageSize: '1000' }, valid: false },
];
