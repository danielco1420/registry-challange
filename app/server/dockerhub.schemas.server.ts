/**
 * Valibot schemas for the Docker Hub responses we read (docs/API.md A to D),
 * passed to `dockerHub.get(request, schema)`. A body that fails its schema
 * becomes an `UpstreamError` `bad_payload` with the failing `issuePath`.
 *
 * Policy (RISKS.md 1.3): require only what we can't work without (identity
 * fields, list containers, totals) and type-check the rest as optional and
 * nullable. Upstream adding fields, dropping a display field or sending `null`
 * doesn't break us; a field changing type does, so drift is caught instead of
 * rendering garbage. `v.object` strips keys we don't list, so cached values
 * only hold what we use.
 *
 * Checked against the recorded responses in `fixtures/dockerhub/` by
 * `dockerhub.schemas.server.test.ts`.
 */
import * as v from 'valibot';

/** A field we use but can live without: absent, `null` or the given type. */
const opt = <const T extends v.GenericSchema>(schema: T) => v.nullish(schema);

const count = v.pipe(v.number(), v.finite());
const optString = opt(v.string());
const optCount = opt(count);

const NameLabel = v.object({ name: optString, label: optString });
const Category = v.object({ name: optString, slug: optString });

// ---------------------------------------------------------------------------
// A. Search v4 (undocumented) and suggestions
// ---------------------------------------------------------------------------

/** One `/api/search/v4` result. Besides images, v4 returns `dhi`, `extension` and `mcp` entries. */
export const SearchV4ResultSchema = v.object({
  /** `library/nginx`, `bitnami/nginx`; `dhi/nginx`, `extension/nginx/docker-extension` or `puppeteer` for non-images. */
  id: v.string(),
  /** `nginx` for official images, else the full `namespace/name` (`Nginx` for `dhi`). */
  name: v.string(),
  /** `image`, `dhi`, `extension`, `mcp`, … */
  type: optString,
  /** `name` is a display name (`NGINX Inc.`), not the namespace; `library` for official images. */
  publisher: opt(v.object({ id: optString, name: optString })),
  created_at: optString,
  updated_at: optString,
  short_description: optString,
  /** `official`, `verified_publisher`, `open_source`, `hardened`, `none`; unknown values map to `none`. */
  badge: optString,
  star_count: optCount,
  /** A display label: `1B+`, `100M+`, `7.0K`, `82`. */
  pull_count: opt(v.union([v.string(), count])),
  raw_pull_count: optCount,
  /** `{}` when the repository has no logo. */
  logo_url: opt(v.object({ large: optString, small: optString })),
  operating_systems: opt(v.array(NameLabel)),
  architectures: opt(v.array(NameLabel)),
  categories: opt(v.array(Category)),
  archived: opt(v.boolean()),
});

/** `/api/search/v4` and `/api/search/v4/suggestions`: same shape. */
export const SearchV4ResponseSchema = v.object({
  total: count,
  results: v.array(SearchV4ResultSchema),
});

// ---------------------------------------------------------------------------
// A (fallback). Legacy search: /v2/search/repositories/
// ---------------------------------------------------------------------------

export const LegacySearchResultSchema = v.object({
  /** `nginx` for official images (no namespace), else `bitnami/nginx`. */
  repo_name: v.string(),
  short_description: optString,
  star_count: optCount,
  /** A number here, unlike v4. */
  pull_count: optCount,
  /** Always `''` in practice. */
  repo_owner: optString,
  is_automated: opt(v.boolean()),
  is_official: opt(v.boolean()),
});

export const LegacySearchResponseSchema = v.object({
  count,
  /** `''` (not `null`) when there is no page. */
  next: optString,
  previous: optString,
  results: v.array(LegacySearchResultSchema),
});

// ---------------------------------------------------------------------------
// B. Repository
// ---------------------------------------------------------------------------

export const RepositorySchema = v.object({
  namespace: v.string(),
  name: v.string(),
  repository_type: optString,
  /** 1 = active, 6 = archived (with `status_description: "archived"`). */
  status: optCount,
  status_description: optString,
  description: optString,
  is_private: opt(v.boolean()),
  star_count: optCount,
  /** A number here, unlike v4. */
  pull_count: optCount,
  last_updated: optString,
  date_registered: optString,
  /** Untrusted Markdown: sanitize before rendering (CLAUDE.md hard rule 5). */
  full_description: optString,
  storage_size: optCount,
  categories: opt(v.array(Category)),
});

// ---------------------------------------------------------------------------
// C. Tags list and single tag
// ---------------------------------------------------------------------------

export const TagImageSchema = v.object({
  /** `unknown` for attestation manifests. */
  architecture: optString,
  variant: optString,
  /** `unknown` for attestation manifests, `''` for some very old images. */
  os: optString,
  size: optCount,
  digest: optString,
  status: optString,
  last_pushed: optString,
  last_pulled: optString,
});

/** One tag, from the tags list or `…/tags/{tag}`. */
export const TagSchema = v.object({
  name: v.string(),
  full_size: optCount,
  last_updated: optString,
  last_updater_username: optString,
  /** `active` or `inactive`. */
  tag_status: optString,
  /** `null` for tags nobody pulled recently. */
  tag_last_pulled: optString,
  tag_last_pushed: optString,
  media_type: optString,
  digest: optString,
  images: opt(v.array(TagImageSchema)),
});

export const TagsResponseSchema = v.object({
  count,
  next: optString,
  previous: optString,
  results: v.array(TagSchema),
});

// ---------------------------------------------------------------------------
// D. Publishers (logo fallback, undocumented)
// ---------------------------------------------------------------------------

/** `/v2/orgs/{name}`. */
export const OrgSchema = v.object({
  orgname: v.string(),
  full_name: optString,
  company: optString,
  profile_url: optString,
  /** `''` when the org has no avatar. */
  gravatar_url: optString,
  /** `Organization`. */
  type: optString,
  badge: optString,
});

/** `/v2/users/{name}`. For an org name it answers `308` to `/v2/orgs/{name}`, which we don't follow. */
export const UserSchema = v.object({
  username: v.string(),
  full_name: optString,
  company: optString,
  profile_url: optString,
  gravatar_url: optString,
  /** `User`. */
  type: optString,
});

/** Docker Hub's error body, e.g. on 404: `{"message":"object not found","errinfo":{}}`. */
export const ErrorBodySchema = v.object({ message: v.string() });

export type SearchV4Result = v.InferOutput<typeof SearchV4ResultSchema>;
export type SearchV4Response = v.InferOutput<typeof SearchV4ResponseSchema>;
export type LegacySearchResult = v.InferOutput<typeof LegacySearchResultSchema>;
export type LegacySearchResponse = v.InferOutput<typeof LegacySearchResponseSchema>;
export type Repository = v.InferOutput<typeof RepositorySchema>;
export type UpstreamTag = v.InferOutput<typeof TagSchema>;
export type TagsResponse = v.InferOutput<typeof TagsResponseSchema>;
export type Org = v.InferOutput<typeof OrgSchema>;
export type User = v.InferOutput<typeof UserSchema>;
