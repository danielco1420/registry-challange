# Docker Hub API map

Last verified live: **2026-11-02**. All endpoints below were called without authentication.

## Public references

- Docker Hub API reference (official, OpenAPI): https://docs.docker.com/reference/api/hub/latest/
  - Get repository: https://docs.docker.com/reference/api/hub/latest/operations/GetRepository/
  - List tags: https://docs.docker.com/reference/api/hub/latest/operations/ListRepositoryTags/
  - Get tag: https://docs.docker.com/reference/api/hub/latest/operations/GetRepositoryTag/
- Usage and rate limits: https://docs.docker.com/docker-hub/usage/
- Personal access tokens (only if we ever authenticate): https://docs.docker.com/security/for-developers/access-tokens/

## How we discovered them

1. **Official docs.** The Docker Hub API reference covers repositories and tags under `/v2/namespaces/...`. It has **no search endpoint**.
2. **DevTools.** We opened https://hub.docker.com/search?q=nginx and watched the Network tab. The Hub UI calls `GET /api/search/v4`, and calls `/api/search/v4/suggestions` for autocomplete.
3. **Legacy search.** `GET /v2/search/repositories/` still works and is referenced in older community docs. It returns fewer fields.
4. **Live probing with curl.** We confirmed shapes, limits, CORS behavior, and error formats (results below).

## Key facts

| Fact | Impact |
|---|---|
| No `Access-Control-Allow-Origin` header on any endpoint | The browser can't call Docker Hub directly, so a backend proxy is required ([ADR-0001](adr/0001-backend-proxy-for-cors.md)) |
| Public reads need no auth | No secrets needed for the basic app |
| `x-ratelimit-limit: 180`, `x-ratelimit-reset` ≈ now + 60 s, per IP (`x-ratelimit-ip`) | About 180 requests/min shared by **all** our users. Server-side cache required. On HTTP 429, honor `Retry-After` |
| `page_size` is silently capped at 100 | Paginate; never try to fetch everything (fluent-bit has 2,189 tags) |
| Errors: `{"message":"object not found","errinfo":{}}` + HTTP 404 | Map to a "not found" UI state |
| Official images live in namespace `library` | Pull command is `docker pull nginx:tag`, not `library/nginx:tag` |
| Cloudflare in front (`__cf_bm` cookie) | Heavy automated traffic may be challenged |

---

## A. Search: `GET https://hub.docker.com/api/search/v4` (undocumented)

| Param | Type | Notes |
|---|---|---|
| `query` | string | May be empty (browse mode) |
| `from` | int | Offset |
| `size` | int | Page size |
| `sort` | `pull_count` \| `star_count` \| `updated_at` | Omit for relevance |
| `order` | `asc` \| `desc` | |
| `badges` | `official` \| `verified_publisher` \| `open_source` | Filter |
| `type` | `image` \| `plugin` \| `extension` | Filter |
| `operating_system`, `architecture` | string | Filters |

Response (trimmed):

```json
{
  "total": 295807,
  "results": [{
    "id": "library/nginx",
    "name": "nginx",
    "slug": "nginx",
    "type": "image",
    "publisher": { "id": "33ef5742…", "name": "library" },
    "created_at": "2014-06-05T19:14:45Z",
    "updated_at": "2026-10-31T01:52:43.634621Z",
    "short_description": "Official build of Nginx.",
    "badge": "official",
    "star_count": 21414,
    "pull_count": "1B+",
    "raw_pull_count": 13536895997,
    "logo_url": { "large": "https://…cloudfront.net/…", "small": "https://…" },
    "operating_systems": [{ "name": "linux", "label": "Linux" }],
    "architectures": [{ "name": "amd64", "label": "x86-64" }],
    "categories": [{ "slug": "web-servers", "name": "Web servers" }],
    "archived": false
  }],
  "search_after": [38312000, "dhi/nginx"]
}
```

| Field | Used for |
|---|---|
| `id` | Route key (`namespace/name`) |
| `name` | Card title |
| `publisher.name` | Owner |
| `short_description` | Description |
| `logo_url.small` / `.large` | Logo (often missing, so we need a fallback) |
| `badge` | Trust badge (`official`, `verified_publisher`, `open_source`, `hardened`, `none`) |
| `pull_count` / `raw_pull_count` | Pull stat ("1B+" display string vs number) |
| `star_count`, `updated_at` | Stats |
| `architectures[].label`, `operating_systems[].label` | Optional chips |
| `archived` | Hide or flag |

Observed in the recorded responses (`fixtures/dockerhub/search-v4-*.json`, 2026-11-02), beyond the trimmed example above:

- `name` is the bare name only for official images (`nginx`). For everything else it's the full `namespace/name` (`nginx/nginx-ingress`), so we take the namespace and name from `id`.
- `publisher.name` is a display name (`NGINX Inc.`, `VMware`), not the namespace (`library` for official images).
- A repo without a logo has `logo_url: {}`. Most community repos have none.
- `pull_count` is a display label: exact below 1,000 (`"82"`), one decimal below 10,000 (`"7.0K"`), else a bucket (`"10K+"`, `"50K+"`, `"100K+"`, `"500K+"`, `"1M+"`, … `"100M+"`, `"1B+"`). `raw_pull_count` holds the number.
- `short_description` is often `""`. `media_types`, `content_types` and `additional_metadata` can be `null`.
- Results aren't all repositories: `type` can be `dhi` (`id: "dhi/nginx"`, `name: "Nginx"`), `extension` (`id: "extension/nginx/docker-extension"`) or `mcp` (`id: "puppeteer"`). We drop anything that isn't `type: "image"` with an `id` of the form `namespace/name`.
- `badge` also takes `hardened`; `categories[].slug` is sometimes the display name (`"Web servers"`).

**Popular 10:** `?query=&badges=official&sort=pull_count&order=desc&size=10`. Without the `badges` filter, the top results are noisy (e.g. `stakater/reloader` comes first).

**Autocomplete:** `GET /api/search/v4/suggestions?query=ngi`. Same result shape.

**Fallback (legacy):** `GET https://hub.docker.com/v2/search/repositories/?query=nginx&page=1&page_size=25`

```json
{ "count": 295796, "next": "…", "previous": "",
  "results": [{ "repo_name": "nginx", "short_description": "Official build of Nginx.",
                "star_count": 21414, "pull_count": 13536895997, "repo_owner": "",
                "is_automated": false, "is_official": true }] }
```

It has no logos and no updated date, so we use it only as a backup. More limits seen live: `repo_name` has no namespace for official images (`nginx`); `next`/`previous` are `""` (not `null`) when there's no page; an empty `query` returns `count: 0`; `ordering` is ignored; `is_official=true` filters only partly (other repos still appear). So it can't stand in for "popular" or a badge-filtered search (see [Search fallback](#search-fallback-appserversearchserverts)).

---

## B. Repository: `GET https://hub.docker.com/v2/namespaces/{namespace}/repositories/{repository}` (documented)

Response (trimmed):

```json
{
  "user": "fluent", "name": "fluent-bit", "namespace": "fluent",
  "repository_type": "image", "status": 1, "status_description": "active",
  "description": "Fluent Bit, lightweight logs and metrics collector and forwarder",
  "is_private": false, "is_automated": true,
  "star_count": 129, "pull_count": 15959804029,
  "last_updated": "2026-10-28T23:49:27.002159Z",
  "date_registered": "2017-02-10T02:52:58.27397Z",
  "full_description": "# Fluent Bit\n\n…markdown…",
  "storage_size": 123456789,
  "categories": [ … ]
}
```

| Field | Used for |
|---|---|
| `namespace`, `name` | Title, owner |
| `description` | Short description |
| `full_description` | Overview Markdown. **Must be sanitized** before rendering |
| `last_updated`, `date_registered` | Dates |
| `pull_count`, `star_count` | Stats |
| `storage_size` | Total repository size |
| `categories[]`, `status_description` | Optional metadata |

Ignored: `permissions`, `has_starred`, `collaborator_count`, `immutable_tags_settings`, `hub_user`, `affiliation`.

An **archived** repository still answers 200, with `status: 6` and `status_description: "archived"` (active is `status: 1`, `"active"`), so it isn't a 404. `full_description` can be `""`. The response has no badge either: we infer `official` for `library` and otherwise reuse the search result when we have it.

The response has no logo. Use the search result already in the client cache, or the avatar fallback (D).

---

## C. Tags: `GET https://hub.docker.com/v2/namespaces/{ns}/repositories/{repo}/tags` (documented)

| Param | Notes |
|---|---|
| `page` | 1-based |
| `page_size` | ≤ 100 (silently capped) |
| `ordering` | `last_updated`, `-last_updated`, `name`, `-name` |
| `name` | Substring filter (`name=alpine` matches 795 nginx tags), so we get tag search for free |

Response (trimmed):

```json
{
  "count": 2189,
  "next": "https://hub.docker.com/v2/namespaces/fluent/repositories/fluent-bit/tags?ordering=last_updated&page=2&page_size=1",
  "previous": null,
  "results": [{
    "name": "5.1.5-2",
    "full_size": 62592256,
    "last_updated": "2026-10-28T23:49:26.553172Z",
    "last_updater_username": "edsiper",
    "tag_status": "active",
    "tag_last_pulled": "2026-11-02T08:37:09.409496096Z",
    "tag_last_pushed": "2026-10-28T23:49:26.553172Z",
    "media_type": "application/vnd.docker.distribution.manifest.list.v2+json",
    "digest": "sha256:1e1b4b0a…",
    "images": [
      { "architecture": "amd64", "variant": null, "os": "linux",
        "size": 62592256, "digest": "sha256:9b6786d8…", "status": "active",
        "last_pushed": "2026-10-28T23:49:06.235971562Z" },
      { "architecture": "arm64", "variant": "v8", "os": "linux", "size": 61709184, "digest": "sha256:35100a7c…" }
    ]
  }]
}
```

| Field | Used for |
|---|---|
| `name` | Tag name and pull command |
| `last_updated` (or `tag_last_pushed`) | "Last updated" |
| `full_size` | Size |
| `digest` | Optional "pull by digest" |
| `last_updater_username` | Optional "pushed by" |
| `tag_last_pulled` | Optional activity signal |
| `images[]` (`architecture`, `variant`, `os`, `size`) | Optional per-platform breakdown |

**Single tag:** `GET …/tags/{tag}` returns the same object shape. Use it for deep links.

Observed in the recorded tags (`fixtures/dockerhub/tags-*.json`):

- `ordering=last_updated` returns the **newest** first and `-last_updated` the **oldest** first, the reverse of the usual convention.
- Official images list attestation manifests in `images[]` with `architecture: "unknown"` and `os: "unknown"` (8 of nginx's 16 entries). They aren't pullable platforms, so we drop them.
- Some very old images have `os: ""`; Windows images have `os: "windows"` and an `os_version`.
- `tag_last_pulled` is `null` for tags nobody pulled recently; `tag_status` and `images[].status` can be `inactive`.
- We never saw `full_size: 0` live, but treat `0`/`null` as unknown size ("—", RISKS.md 4.3).

---

## D. Publisher avatar (logo fallback, undocumented)

- Org: `GET https://hub.docker.com/v2/orgs/{name}` returns `{ orgname, full_name, company, profile_url, gravatar_url, type: "Organization", badge, … }`
- User: `GET https://hub.docker.com/v2/users/{name}` returns `{ username, full_name, company, profile_url, gravatar_url, type: "User", … }`
- For an org name, `/v2/users/{name}` answers `308` with `Location: /v2/orgs/{name}`. Our client doesn't follow redirects (that's an `unavailable` error), so try `/v2/orgs/{name}` first and `/v2/users/{name}` on a 404.
- `gravatar_url` is `""` when there's no avatar.
- Last resort: an initials avatar generated on the client.

---

## What our frontend consumes

The proxy normalizes upstream responses into these DTOs (types in `app/lib/dto.ts`):

```ts
type Badge = 'official' | 'verified_publisher' | 'open_source' | 'hardened' | 'none';

interface RepoSummary {
  id: string;            // "library/nginx"
  namespace: string;     // "library"
  name: string;          // "nginx"
  displayName: string;   // "nginx" (library) or "fluent/fluent-bit"
  owner: string;         // publisher display name from search ("NGINX Inc."), else the namespace
  description: string;   // "" when none
  logoUrl?: string;      // https only; absent when Docker Hub has none
  badge: Badge;
  pulls: number;
  pullsLabel: string;    // "1B+"
  stars: number;
  updatedAt: string;     // ISO, "" when unknown
  archs: string[];       // human labels from search ("x86-64", "ARM 64"); [] without a search result
  archived: boolean;
}

interface RepoDetails extends RepoSummary {
  fullDescriptionMd: string;
  registeredAt: string;
  storageSize?: number;
  categories: string[];
}

interface Tag {
  name: string;
  updatedAt: string;
  size: number;
  digest?: string;
  pushedBy?: string;
  lastPulled?: string;
  // arch is the raw platform name ("amd64", "arm64"), as in `--platform linux/arm64/v8`,
  // unlike RepoSummary.archs, which holds search's display labels
  images: { arch: string; variant?: string; os: string; size: number }[];
}

interface Page<T> { items: T[]; total: number; page: number; pageSize: number; }

// /api/popular, /api/search, /api/search/suggestions
interface SearchPage extends Page<RepoSummary> {
  source: 'v4' | 'legacy'; // legacy: v4 failed its schema; no logos, dates or platforms, unsorted
}

// /api/publishers/:name
interface Publisher {
  name: string;          // "fluent"
  displayName: string;   // full_name, else company, else name
  kind: 'organization' | 'user';
  avatarUrl?: string;    // https only; absent when gravatar_url is ""
  badge: Badge;          // the org's badge; "none" for users
}

// Every /api/* error
interface ApiErrorBody {
  error: { code: 'invalid_params' | 'not_found' | 'method_not_allowed' | 'rate_limited' | 'upstream_unavailable' | 'internal_error';
           message: string; };   // a 400 also has issues: { param, message }[]
}

const pullCommand = (ns: string, repo: string, tag: string) =>
  `docker pull ${ns === 'library' ? repo : `${ns}/${repo}`}:${tag}`;
```

### Schemas and normalizers

Each upstream response is validated with a Valibot schema in `app/server/dockerhub.schemas.server.ts` (search v4 and suggestions, legacy search, repository, tags list, single tag, org, user), then turned into the DTOs above by `app/server/normalize.server.ts`. The schemas require only identity fields, list containers and totals; display fields are optional and nullable, so `null` or a missing field falls back instead of failing, while a field changing type fails. Contract tests run every recorded response in `fixtures/dockerhub/` through them.

| Upstream quirk | DTO |
|---|---|
| `library` namespace | `displayName: "nginx"`, `badge: "official"` (the repository endpoint has no badge) |
| v4 `pull_count: "1B+"` + `raw_pull_count` number; repository/legacy `pull_count` number | `pulls` from the number (else parsed from the label), `pullsLabel` from the label (else built the same way Docker Hub builds it) |
| `logo_url: {}`, non-`https:` URL | `logoUrl` absent |
| `short_description: ""`/`null`, `full_description` missing | `""` |
| `full_size`/`storage_size` `0`, `null` or negative | `size: 0` / `storageSize` absent |
| `images[]` entries `unknown/unknown` | dropped |
| v4 `type` other than `image`, or an `id` our `:ns`/`:repo` params can't express | result dropped (`total` stays Docker Hub's count) |
| unknown `badge` | `"none"` |
| `status_description: "archived"` / `archived: true` | `archived: true` |
| org/user `full_name: ""`, `gravatar_url: ""` (`toOrgPublisher`, `toUserPublisher`) | `displayName` from `company`, else the name; `avatarUrl` absent |
| repository endpoint has no publisher name, logo, badge or platforms | `toRepoDetails(repo, summary)` takes them from the search result with the same `id`; without one (a direct link), `owner` is the namespace, no logo, `archs: []`, and `badge` is `official` for `library`, else `none` (a verified publisher loses its badge) |

### Proxy routes (allowlist only)

Resource routes in `app/routes/api.*.ts`, registered in `app/routes.ts`, sharing `app/server/api.server.ts`.

| Our route | Upstream | DTO | Cache TTL (env) | 404 when |
|---|---|---|---|---|
| `GET /api/popular` | A with `query=&badges=official&sort=pull_count&order=desc&size=10` | `SearchPage` | `CACHE_TTL_POPULAR` (600 s) | |
| `GET /api/search?q=&page=&pageSize=&sort=&badge=` | A (legacy fallback on drift) | `SearchPage` | `CACHE_TTL_SEARCH` (60 s) | |
| `GET /api/search/suggestions?q=` | A `/suggestions` (legacy fallback on drift) | `SearchPage` (`pageSize: 10`) | `CACHE_TTL_SEARCH` (60 s) | |
| `GET /api/repos/:ns/:repo` | B | `RepoDetails` | `CACHE_TTL_REPO` (300 s) | no such repository |
| `GET /api/repos/:ns/:repo/tags?page=&pageSize=&ordering=&name=` | C | `Page<Tag>` | `CACHE_TTL_TAGS` (120 s) | no such repository, or `page` is past the last page (Docker Hub answers 404 for both; the message is `Repository or page not found` when `page > 1`) |
| `GET /api/repos/:ns/:repo/tags/:tag` | C, single tag | `Tag` | `CACHE_TTL_TAGS` (120 s) | no such tag |
| `GET /api/publishers/:name` | D: `/v2/orgs/{name}`, then `/v2/users/{name}` on a 404 | `Publisher` | `CACHE_TTL_PUBLISHER` (3600 s) | neither an org nor a user |

The proxy never forwards arbitrary paths or URLs. Any other `/api/*` path, with any method, answers `404` `{ "error": { "code": "not_found", "message": "Not found" } }` (`Cache-Control: no-store`) and calls nothing upstream (`app/routes/api.$.ts`). A method other than `GET`/`HEAD` on a proxy route answers `405` `method_not_allowed` with `Allow: GET, HEAD` and `Cache-Control: no-store` (rate limited like any `/api/*` request). `/api/health` is not a proxy route and isn't rate limited.

Every proxy route, in order (`handleApi` and `proxyJson`):

1. **Per-client rate limit** (`enforceRateLimit`): over the limit, `429` `rate_limited` with `Retry-After`.
2. **Params** validated with the schemas below: `400` `invalid_params` with `issues`, nothing sent upstream.
3. **Cached read** through `getCached` with the TTL above. The cache key holds every validated param that changes the answer (after trimming and defaults, so `?q=%20nginx` and `?q=nginx` share an entry).
4. **Answer:**

| Situation | Status | Headers | Body |
|---|---|---|---|
| Data, fresh or just fetched | 200 | `X-Cache: HIT`/`MISS`, `Age`, `Cache-Control: public, max-age=<ttl>` | the DTO |
| Data, stale (see the budget table below) | 200 | `X-Cache: STALE`, `Age`, `Cache-Control: no-store` | the DTO |
| Upstream 404 for a repository, tag or publisher | 404 | as for data: the miss is cached with the same TTL, so repeated misses don't spend the budget | `not_found` |
| No cached entry; Docker Hub failing or budget spent | 503 | `Retry-After`, `Cache-Control: no-store` | `upstream_unavailable` |
| Upstream 404 from a search endpoint (it should always answer, so the endpoint changed) | 503 | `Retry-After` (5 s, or the budget's wait if longer), `Cache-Control: no-store` | `upstream_unavailable` |
| Anything unexpected (logged server-side) | 500 | `Cache-Control: no-store` | `internal_error`, no details |

`fullDescriptionMd` in `RepoDetails` is the raw upstream Markdown, sent as JSON; the UI must sanitize it before rendering (CLAUDE.md hard rule 5).

### Param validation

Every proxy route validates its params with the Valibot schemas in `app/lib/params.ts` (`parseOrThrow` from `app/lib/validate.ts`). A failed parse returns `400` with `Cache-Control: no-store` and this body (messages never echo the input):

```json
{ "error": { "code": "invalid_params", "message": "Invalid request parameters",
             "issues": [{ "param": "page", "message": "page must be a whole number between 1 and 100" }] } }
```

| Our param | Rule | Default | Upstream |
|---|---|---|---|
| `:ns`, `:repo`, `:name` (publisher) | `^[a-z0-9]+(?:[._-][a-z0-9]+)*$`, ≤ 255 chars | | path segment, `encodeURIComponent` |
| `:tag` | `^[\w][\w.-]{0,127}$` (ASCII) | | path segment |
| `q` | trimmed, ≤ 100 chars, no control chars; required and not blank for suggestions | `''` (search) | `query` |
| `page` | integer 1–100, and `page × pageSize ≤ 1000` (search and tags) | `1` | search: `from = (page - 1) * pageSize`; tags: `page` |
| `pageSize` | integer 1–100 | `25` | search: `size`; tags: `page_size` |
| `sort` (search) | `relevance` \| `pulls` \| `stars` \| `updated` | `relevance` | `sort` omitted \| `pull_count` \| `star_count` \| `updated_at`, with `order=desc` |
| `badge` (search) | `official` \| `verified_publisher` \| `open_source` | none | `badges` |
| `ordering` (tags) | `last_updated` \| `-last_updated` \| `name` \| `-name` | none | `ordering` |
| `name` (tags) | trimmed, `[\w.-]*`, ≤ 128 chars | none | `name` |

Query strings: unknown keys are ignored, empty values count as missing, and a repeated key uses its first value.

**Anonymous paging cap** (checked live, 2026-11-03): without sign-in, Docker Hub serves only the first 1000 results. Search v4 answers `403` `{"message":"pagination too large for anonymous requests; …"}` when `from + size > 1000`, and the tags list answers `403` `{"message":"pagination offset too large for anonymous requests; …"}` once the offset reaches 1000. Our client would treat that `403` as `unavailable` (a misleading `503` that spends a budget slot on every request), so `page × pageSize > 1000` is a `400` (`ANONYMOUS_RESULTS_MAX` in `app/lib/params.ts`). Search `total` can be far larger (e.g. 295,913 for `nginx`), so the UI must cap its page links at `floor(1000 / pageSize)`.

## Upstream client (`app/server/dockerhub.server.ts`)

The only code that builds Docker Hub URLs. Callers pass a typed request (`search`, `suggestions`, `legacySearch`, `repository`, `tags`, `tag`, `org`, `user`) made from the validated param types above, plus a Valibot schema for the response. It never accepts a URL or path: path segments are re-checked against the `:ns`/`:repo`/`:tag` patterns and `encodeURIComponent`-ed, query values go through `URLSearchParams`, and the URL must stay on `DOCKERHUB_BASE_URL`.

| Aspect | Behavior |
|---|---|
| Request | `GET`, `Accept: application/json`, `User-Agent: registry-ui (+https://github.com/danielco1420/registry-challange)`, no auth, redirects not followed |
| Timeout | `UPSTREAM_TIMEOUT_MS` (default 8000) per attempt, covering headers and body |
| Retry | One retry (2 attempts max) on 429, 5xx, timeout, network error, or a 2xx that isn't JSON. Waits `Retry-After` (delta seconds or IMF-fixdate; other formats are ignored) when sent; for a 429 without it, waits until `x-ratelimit-reset`; else 250–500 ms. A wait over 3 s (`MAX_RETRY_AFTER_MS`) isn't done in-request: the error is thrown at once with `retryAfterSeconds` (clamped to 86400) so the caller can serve stale data or pass the delay on. Worst case per call: 2 × `UPSTREAM_TIMEOUT_MS` + 3 s |
| Not retried | 404, other 4xx/3xx, JSON that fails the schema |

Failures throw `UpstreamError` with a `kind` (plus `status` and `retryAfterSeconds` when known; messages never include the upstream body):

| Upstream result | `kind` |
|---|---|
| 404 (`{"message":"object not found","errinfo":{}}`) | `not_found` |
| 429 | `rate_limited` |
| 5xx, timeout, network error, other non-2xx (e.g. a Cloudflare 403 challenge), redirect | `unavailable` |
| 2xx with a non-JSON `Content-Type` or body (e.g. Cloudflare HTML), or JSON that fails the schema | `bad_payload` |
| No upstream budget slot left (nothing sent) | `budget_exhausted` |

For JSON that fails the schema, the error also carries `issuePath`, the first failing field as a JSONPath-like string (`$.results[3].publisher.name`, `$` for the root), and the message ends with it. It names keys and indexes only, never upstream values, so it's safe to log. That relies on the response schemas using only `v.object` and arrays (no `v.record`, `v.looseObject`, `v.objectWithRest` or `v.map`, whose keys come from the body); a test enforces it. `isSchemaMismatch(error)` tells this case apart from a non-JSON body.

### Search fallback (`app/server/search.server.ts`)

`searchRepositories(client, query)` and `suggestRepositories(client, q)` call v4 first. When v4 fails its schema (`isSchemaMismatch`), they make one call to the legacy `/v2/search/repositories/?query=&page=&page_size=` (client endpoint `legacySearch`) and return the same `Page<RepoSummary>` with `source: 'legacy'` (no logos, dates or platforms), logging the failing path with `console.warn`. The fallback only runs for a non-empty query without a badge filter, since the legacy endpoint can't express "popular" or a badge. A `sort` is dropped (legacy ignores `ordering`), so a sorted query comes back in relevance order; the UI should use `source: 'legacy'` to say results are limited. Otherwise, and for any other failure (404, 429, 5xx, non-JSON, budget), the original error is rethrown for `getCached` to handle.

## Upstream budget and failure path (`app/server/budget.server.ts`, `app/server/upstream.server.ts`)

Every attempt the client sends, retries included, first takes a slot from the proxy-wide budget: at most `UPSTREAM_BUDGET_PER_MIN` (default and maximum 150) in any 60 s, a sliding window kept below Docker Hub's ~180 req/min. No slot for the first attempt: nothing is sent and the call fails with `budget_exhausted`. No slot for the retry: the retry is skipped and the first failure is thrown. Cache hits and single-flight followers never reach the client, so they don't count.

Routes and loaders read through `getCached(key, ttlSeconds, fetcher)`, which returns `{ value, status, ageMs, degraded }`:

| Situation | `/api/*` response | `degraded` |
|---|---|---|
| Fresh entry or successful fetch | 200, `X-Cache: HIT`/`MISS`, `Age`, `Cache-Control: public, max-age=<ttl>` | false |
| Stale entry, background refresh running (healthy upstream) | 200, `X-Cache: STALE`, `Cache-Control: no-store` | false |
| Stale entry, budget exhausted or its last refresh failed | 200, `X-Cache: STALE`, `Cache-Control: no-store`, no `Retry-After` | true |
| No entry; budget exhausted, or 429 / 5xx / timeout / network error / bad payload | 503, `Cache-Control: no-store`, `Retry-After` | (thrown) |
| No entry; 404 | `UpstreamError` `not_found` rethrown. The repository, tags, tag and publisher routes catch it inside their fetcher (`orNotFound`), so "not found" is cached and answered as a `404` (see [Proxy routes](#proxy-routes-allowlist-only)) | (thrown) |

The 503 body is `{ "error": { "code": "upstream_unavailable", "message": "Docker Hub is unavailable right now. Try again later." } }`. `Retry-After` is the seconds until the budget frees a slot when the budget is the cause; for an upstream failure it is the upstream's own `Retry-After` (or the larger budget wait), else 5 s. Always at least 1.

## Re-verify (curl probes)

```bash
curl -s "https://hub.docker.com/api/search/v4?query=&badges=official&sort=pull_count&order=desc&size=10"
curl -s "https://hub.docker.com/v2/namespaces/fluent/repositories/fluent-bit"
curl -s "https://hub.docker.com/v2/namespaces/fluent/repositories/fluent-bit/tags?page_size=5&ordering=last_updated"
curl -s -D - -o /dev/null -H "Origin: http://localhost:5173" "https://hub.docker.com/v2/repositories/library/nginx/tags?page_size=1"   # shows rate-limit headers, no CORS
```
