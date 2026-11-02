/**
 * Contract tests (RISKS.md 1.3): every recorded Docker Hub response in
 * `fixtures/dockerhub/` must pass its schema. When Docker Hub changes a shape,
 * re-record the fixture (see its README) and this test shows what broke.
 */
import * as v from 'valibot';
import { describe, expect, it } from 'vitest';
import { cloneFixture, fixtures } from '../../test/msw/dockerhub';
import { formatIssuePath } from './dockerhub.server';
import {
  ErrorBodySchema,
  LegacySearchResponseSchema,
  OrgSchema,
  RepositorySchema,
  SearchV4ResponseSchema,
  TagSchema,
  TagsResponseSchema,
  UserSchema,
} from './dockerhub.schemas.server';

const cases: [keyof typeof fixtures, v.GenericSchema][] = [
  ['searchV4Popular', SearchV4ResponseSchema],
  ['searchV4Nginx', SearchV4ResponseSchema],
  ['searchV4Hello', SearchV4ResponseSchema],
  ['searchV4Kernel528Archived', SearchV4ResponseSchema],
  ['searchV4SuggestionsNgi', SearchV4ResponseSchema],
  ['searchLegacyNginx', LegacySearchResponseSchema],
  ['repoNginx', RepositorySchema],
  ['repoFluentBit', RepositorySchema],
  ['repoNginxdemosHello', RepositorySchema],
  ['repoKernel528Archived', RepositorySchema],
  ['tagsNginx', TagsResponseSchema],
  ['tagsFluentBit', TagsResponseSchema],
  ['tagsFluentBitOldest', TagsResponseSchema],
  ['tagsKernel528Archived', TagsResponseSchema],
  ['tagNginxLatest', TagSchema],
  ['orgDocker', OrgSchema],
  ['orgFluent', OrgSchema],
  ['userKernel528', UserSchema],
  ['errorNotFound', ErrorBodySchema],
];

/** The first failing path of a parse, as the client reports it. */
function failingPath(schema: v.GenericSchema, input: unknown): string | undefined {
  const result = v.safeParse(schema, input);
  return result.success ? undefined : formatIssuePath(result.issues[0].path);
}

describe('recorded fixtures match their schemas', () => {
  it.each(cases)('%s', (name, schema) => {
    const result = v.safeParse(schema, fixtures[name]);
    expect(result.issues?.map((issue) => `${formatIssuePath(issue.path)}: ${issue.message}`)).toBe(
      undefined,
    );
  });

  it('strips fields we never read', () => {
    const output = v.parse(RepositorySchema, fixtures.repoNginx);
    expect(output).not.toHaveProperty('permissions');
    expect(output).not.toHaveProperty('hub_user');
    expect(output).toHaveProperty('full_description');
  });
});

describe('search v4 is defensive about display fields but not about identity', () => {
  it('accepts null or missing display fields', () => {
    const body = cloneFixture(fixtures.searchV4Nginx) as Record<string, unknown> & {
      results: Record<string, unknown>[];
    };
    const [first] = body.results;
    if (!first) throw new Error('fixture has no results');
    for (const key of ['logo_url', 'short_description', 'architectures', 'publisher', 'badge']) {
      first[key] = null;
    }
    delete first.raw_pull_count;
    delete first.updated_at;
    expect(failingPath(SearchV4ResponseSchema, body)).toBeUndefined();
  });

  type Body = { total?: unknown; results?: Record<string, unknown>[] };
  const setField = (index: number, key: string, value: unknown) => (body: Body) => {
    const result = body.results?.[index];
    if (!result) throw new Error(`fixture has no result ${index}`);
    result[key] = value;
  };
  const drifts: [string, (body: Body) => void, string][] = [
    ['results renamed', (body) => delete body.results, '$.results'],
    ['id no longer a string', setField(2, 'id', 42), '$.results[2].id'],
    [
      'star_count turned into a string',
      setField(0, 'star_count', '21K'),
      '$.results[0].star_count',
    ],
    [
      'logo_url turned into a string',
      setField(1, 'logo_url', 'https://x'),
      '$.results[1].logo_url',
    ],
    ['total missing', (body) => delete body.total, '$.total'],
  ];

  it.each(drifts)('rejects drift: %s', (_label, mutate, path) => {
    const body = cloneFixture(fixtures.searchV4Nginx) as Body;
    mutate(body);
    expect(failingPath(SearchV4ResponseSchema, body)).toBe(path);
  });

  it('rejects a body that is not an object at the root', () => {
    expect(failingPath(SearchV4ResponseSchema, null)).toBe('$');
    expect(failingPath(SearchV4ResponseSchema, 'Just a moment...')).toBe('$');
  });
});

describe('formatIssuePath', () => {
  it('formats keys and indexes, never values', () => {
    expect(formatIssuePath(undefined)).toBe('$');
    expect(formatIssuePath([{ key: 'results' }, { key: 3 }, { key: 'logo_url' }])).toBe(
      '$.results[3].logo_url',
    );
    expect(formatIssuePath([{ key: 'odd key' }, { key: Symbol('x') }])).toBe(
      '$["odd key"]["Symbol(x)"]',
    );
  });
});
