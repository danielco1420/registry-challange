/**
 * Turns validated Docker Hub payloads (`dockerhub.schemas.server.ts`) into the
 * DTOs our routes return (`app/lib/dto.ts`, docs/API.md). Pure functions: no
 * I/O, no `Date.now()`.
 *
 * Handles (RISKS.md 4.1 to 4.3):
 * - `library` namespace: `displayName` is just `nginx`, badge `official`.
 * - Pull counts: v4 sends a label (`"1B+"`) in `pull_count` and the number in
 *   `raw_pull_count`; the repository and legacy endpoints send a number in
 *   `pull_count`. We always return both `pulls` and `pullsLabel`.
 * - Missing logo (`logo_url: {}`), description (`''`/`null`), size (`0`/`null`).
 * - Search results that aren't Hub repositories (`dhi`, `extension`, `mcp`, or
 *   an `id` that doesn't pass our `:ns`/`:repo` param grammar) are dropped, so
 *   every item links to a repository page our routes accept.
 */
import {
  BADGE_VALUES,
  type Badge,
  type Page,
  type Publisher,
  type RepoDetails,
  type RepoSummary,
  type Tag,
  type TagImage,
} from '../lib/dto';
import { NAME_MAX_LENGTH, NAME_PATTERN } from '../lib/params';
import { OFFICIAL_NAMESPACE, imageRef } from '../lib/pull-command';
import type {
  LegacySearchResponse,
  LegacySearchResult,
  Org,
  Repository,
  SearchV4Response,
  SearchV4Result,
  TagsResponse,
  UpstreamTag,
  User,
} from './dockerhub.schemas.server';

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

const isName = (value: string) => value.length <= NAME_MAX_LENGTH && NAME_PATTERN.test(value);

/** Splits `ns/repo` (or a bare official `repo`) into valid route params, else `undefined`. */
export function splitRepoId(
  id: string,
  bareNamespace?: string,
): { namespace: string; name: string } | undefined {
  const parts = id.split('/');
  const [namespace, name] =
    parts.length === 1 && bareNamespace !== undefined ? [bareNamespace, parts[0]] : parts;
  if (parts.length > 2 || namespace === undefined || name === undefined) return undefined;
  return isName(namespace) && isName(name) ? { namespace, name } : undefined;
}

/** `nginx` for `library/nginx`, else `fluent/fluent-bit`: the same rule as the pull command. */
export const displayNameFor = imageRef;

/** A known badge, else `none`. */
export function toBadge(value: string | null | undefined): Badge {
  return (BADGE_VALUES as readonly string[]).includes(value ?? '') ? (value as Badge) : 'none';
}

/** Only absolute `https:` URLs, so the UI never renders a `javascript:` or `http:` logo. */
export function safeHttpsUrl(value: string | null | undefined): string | undefined {
  if (!value) return undefined;
  try {
    return new URL(value).protocol === 'https:' ? value : undefined;
  } catch {
    return undefined;
  }
}

const nonNegative = (value: number | null | undefined) =>
  typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0;

const text = (value: string | null | undefined) => value?.trim() ?? '';

/** `undefined` instead of `''`/`null`, for optional DTO fields. */
const optionalText = (value: string | null | undefined) => text(value) || undefined;

// ---------------------------------------------------------------------------
// Pull counts (RISKS.md 4.2)
// ---------------------------------------------------------------------------

const UNITS: Record<string, number> = { K: 1e3, M: 1e6, B: 1e9 };

/**
 * The number behind a Docker Hub pull label: `"1B+"` → 1e9, `"7.0K"` → 7000,
 * `"82"` → 82. A `+` label is a lower bound. `undefined` when unparseable.
 */
export function parsePullsLabel(label: string): number | undefined {
  const match = /^\s*(\d+(?:\.\d+)?)\s*([KMB])?\+?\s*$/i.exec(label.replaceAll(',', ''));
  if (!match) return undefined;
  const [, digits = '', unit] = match;
  return Math.round(Number(digits) * (unit ? (UNITS[unit.toUpperCase()] ?? 1) : 1));
}

/** Docker Hub's buckets at or above 10K, largest first (500M+ inferred from the 5×10ⁿ pattern). */
const PULL_BUCKETS: [number, string][] = [
  [1e9, '1B+'],
  [5e8, '500M+'],
  [1e8, '100M+'],
  [5e7, '50M+'],
  [1e7, '10M+'],
  [5e6, '5M+'],
  [1e6, '1M+'],
  [5e5, '500K+'],
  [1e5, '100K+'],
  [5e4, '50K+'],
  [1e4, '10K+'],
];

/**
 * Builds the label Docker Hub's own search shows for a pull count, for
 * endpoints that only send the number: exact below 1,000 (`82`), one decimal
 * in thousands below 10,000 (`7.0K`), else a bucket (`10K+` … `1B+`).
 * Matches every label in the recorded fixtures.
 */
export function pullsLabelFor(pulls: number): string {
  const n = Math.max(0, Math.floor(pulls));
  if (n < 1000) return String(n);
  if (n < 10_000) return `${Math.min(n / 1000, 9.9).toFixed(1)}K`;
  for (const [min, label] of PULL_BUCKETS) if (n >= min) return label;
  return '10K+';
}

/** `pulls` and `pullsLabel` from whatever mix of label and number upstream sent. */
export function normalizePulls(
  pullCount: string | number | null | undefined,
  rawPullCount?: number | null,
): { pulls: number; pullsLabel: string } {
  const label = typeof pullCount === 'string' ? pullCount.trim() : '';
  const pulls =
    typeof rawPullCount === 'number'
      ? nonNegative(rawPullCount)
      : typeof pullCount === 'number'
        ? nonNegative(pullCount)
        : (parsePullsLabel(label) ?? 0);
  return { pulls, pullsLabel: label || pullsLabelFor(pulls) };
}

// ---------------------------------------------------------------------------
// Search (A)
// ---------------------------------------------------------------------------

/** Architecture labels for chips (`x86-64`, `ARM 64`), without `unknown` or duplicates. */
function archLabels(architectures: SearchV4Result['architectures']): string[] {
  const labels = (architectures ?? [])
    .filter((arch) => arch.name !== 'unknown')
    .map((arch) => text(arch.label) || text(arch.name))
    .filter((label) => label !== '' && label !== 'unknown');
  return [...new Set(labels)];
}

/** One v4 search result, or `undefined` for entries that aren't Hub repositories. */
export function toRepoSummary(result: SearchV4Result): RepoSummary | undefined {
  if (result.type != null && result.type !== 'image') return undefined;
  const ref = splitRepoId(result.id);
  if (!ref) return undefined;
  const { namespace, name } = ref;
  const logo = result.logo_url;
  return {
    id: `${namespace}/${name}`,
    namespace,
    name,
    displayName: displayNameFor(namespace, name),
    owner: text(result.publisher?.name) || namespace,
    description: text(result.short_description),
    logoUrl: safeHttpsUrl(logo?.small) ?? safeHttpsUrl(logo?.large),
    badge: toBadge(result.badge),
    ...normalizePulls(result.pull_count, result.raw_pull_count),
    stars: nonNegative(result.star_count),
    updatedAt: text(result.updated_at),
    archs: archLabels(result.architectures),
    archived: result.archived === true,
  };
}

/** Request paging, echoed into `Page<T>` (v4 pages by offset, so it doesn't send them back). */
export interface Paging {
  page: number;
  pageSize: number;
}

function page<T>(items: T[], total: number, paging: Paging): Page<T> {
  return { items, total: nonNegative(total), page: paging.page, pageSize: paging.pageSize };
}

const defined = <T>(value: T | undefined): value is T => value !== undefined;

/** A v4 search or suggestions response. `total` is Docker Hub's count, including skipped entries. */
export function toSearchPage(body: SearchV4Response, paging: Paging): Page<RepoSummary> {
  return page(body.results.map(toRepoSummary).filter(defined), body.total, paging);
}

/** One legacy search result. No logo, date or platforms in this endpoint. */
export function toRepoSummaryFromLegacy(result: LegacySearchResult): RepoSummary | undefined {
  const ref = splitRepoId(result.repo_name, OFFICIAL_NAMESPACE);
  if (!ref) return undefined;
  const { namespace, name } = ref;
  const official = result.is_official === true || namespace === OFFICIAL_NAMESPACE;
  return {
    id: `${namespace}/${name}`,
    namespace,
    name,
    displayName: displayNameFor(namespace, name),
    owner: text(result.repo_owner) || namespace,
    description: text(result.short_description),
    badge: official ? 'official' : 'none',
    ...normalizePulls(result.pull_count),
    stars: nonNegative(result.star_count),
    updatedAt: '',
    archs: [],
    archived: false,
  };
}

export function toLegacySearchPage(body: LegacySearchResponse, paging: Paging): Page<RepoSummary> {
  return page(body.results.map(toRepoSummaryFromLegacy).filter(defined), body.count, paging);
}

// ---------------------------------------------------------------------------
// Repository (B)
// ---------------------------------------------------------------------------

/**
 * What the repository endpoint lacks and a search result (if we have one) can
 * fill in, keyed by the result's `id` so it can't be merged into another repo.
 */
export type RepoSummaryExtras = Pick<RepoSummary, 'id'> &
  Partial<Pick<RepoSummary, 'owner' | 'logoUrl' | 'badge' | 'archs'>>;

/**
 * The repository endpoint, optionally merged with the matching search result
 * (`summary`) for the owner display name, logo, badge and architectures, which
 * this endpoint doesn't send. A summary for a different repository is ignored.
 * Without one (a direct deep link), `owner` is the namespace, `logoUrl` is
 * absent, `archs` is empty and `badge` is `official` for `library`, else
 * `none`, even for a verified publisher.
 */
export function toRepoDetails(repo: Repository, summary?: RepoSummaryExtras): RepoDetails {
  const { namespace, name } = repo;
  const id = `${namespace}/${name}`;
  const extras: Partial<RepoSummaryExtras> = summary?.id === id ? summary : {};
  const storageSize = nonNegative(repo.storage_size);
  return {
    id,
    namespace,
    name,
    displayName: displayNameFor(namespace, name),
    owner: extras.owner ?? namespace,
    description: text(repo.description),
    logoUrl: safeHttpsUrl(extras.logoUrl),
    badge: extras.badge ?? (namespace === OFFICIAL_NAMESPACE ? 'official' : 'none'),
    ...normalizePulls(repo.pull_count),
    stars: nonNegative(repo.star_count),
    updatedAt: text(repo.last_updated),
    archs: extras.archs ?? [],
    archived: repo.status_description === 'archived',
    fullDescriptionMd: repo.full_description ?? '',
    registeredAt: text(repo.date_registered),
    storageSize: storageSize > 0 ? storageSize : undefined,
    categories: (repo.categories ?? []).map((c) => text(c.name)).filter((c) => c !== ''),
  };
}

// ---------------------------------------------------------------------------
// Tags (C)
// ---------------------------------------------------------------------------

function toTagImage(image: NonNullable<UpstreamTag['images']>[number]): TagImage | undefined {
  const arch = text(image.architecture);
  const os = text(image.os);
  // Attestation manifests show up as `unknown/unknown`; they aren't pullable platforms.
  if (arch === '' || arch === 'unknown' || os === 'unknown') return undefined;
  return { arch, variant: optionalText(image.variant), os, size: nonNegative(image.size) };
}

export function toTag(tag: UpstreamTag): Tag {
  return {
    name: tag.name,
    updatedAt: text(tag.last_updated) || text(tag.tag_last_pushed),
    size: nonNegative(tag.full_size),
    digest: optionalText(tag.digest),
    pushedBy: optionalText(tag.last_updater_username),
    lastPulled: optionalText(tag.tag_last_pulled),
    images: (tag.images ?? []).map(toTagImage).filter(defined),
  };
}

export function toTagsPage(body: TagsResponse, paging: Paging): Page<Tag> {
  return page(body.results.map(toTag), body.count, paging);
}

// ---------------------------------------------------------------------------
// Publishers (D)
// ---------------------------------------------------------------------------

/** Fields orgs and users share. `gravatar_url: ""` means no avatar. */
function publisher(
  name: string,
  kind: Publisher['kind'],
  body: Pick<Org, 'full_name' | 'company' | 'gravatar_url'>,
  badge: Badge,
): Publisher {
  return {
    name,
    displayName: text(body.full_name) || text(body.company) || name,
    kind,
    avatarUrl: safeHttpsUrl(body.gravatar_url),
    badge,
  };
}

/** `/v2/orgs/{name}`. */
export function toOrgPublisher(org: Org): Publisher {
  return publisher(org.orgname, 'organization', org, toBadge(org.badge));
}

/** `/v2/users/{name}`. Users have no badge. */
export function toUserPublisher(user: User): Publisher {
  return publisher(user.username, 'user', user, 'none');
}
