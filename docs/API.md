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

**Popular 10:** `?query=&badges=official&sort=pull_count&order=desc&size=10`. Without the `badges` filter, the top results are noisy (e.g. `stakater/reloader` comes first).

**Autocomplete:** `GET /api/search/v4/suggestions?query=ngi`. Same result shape.

**Fallback (legacy):** `GET https://hub.docker.com/v2/search/repositories/?query=nginx&page=1&page_size=25`

```json
{ "count": 295796, "next": "…", "previous": "",
  "results": [{ "repo_name": "nginx", "short_description": "Official build of Nginx.",
                "star_count": 21414, "pull_count": 13536895997, "repo_owner": "",
                "is_automated": false, "is_official": true }] }
```

It has no logos and no updated date, so we use it only as a backup.

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

---

## D. Publisher avatar (logo fallback, undocumented)

- Org: `GET https://hub.docker.com/v2/orgs/{name}` returns `{ orgname, full_name, company, profile_url, gravatar_url, type, … }`
- User: `GET https://hub.docker.com/v2/users/{name}` (same idea)
- Last resort: an initials avatar generated on the client.

---

## What our frontend consumes

The proxy normalizes upstream responses into these DTOs:

```ts
type Badge = 'official' | 'verified_publisher' | 'open_source' | 'hardened' | 'none';

interface RepoSummary {
  id: string;            // "library/nginx"
  namespace: string;     // "library"
  name: string;          // "nginx"
  displayName: string;   // "nginx" (library) or "fluent/fluent-bit"
  owner: string;
  description: string;
  logoUrl?: string;
  badge: Badge;
  pulls: number;
  pullsLabel: string;    // "1B+"
  stars: number;
  updatedAt: string;     // ISO
  archs: string[];
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
  images: { arch: string; variant?: string; os: string; size: number }[];
}

interface Page<T> { items: T[]; total: number; page: number; pageSize: number; }

const pullCommand = (ns: string, repo: string, tag: string) =>
  `docker pull ${ns === 'library' ? repo : `${ns}/${repo}`}:${tag}`;
```

### Proxy routes (allowlist only)

| Our route | Upstream |
|---|---|
| `GET /api/popular` | A with `badges=official&sort=pull_count&order=desc&size=10` |
| `GET /api/search?q=&page=&pageSize=&sort=&badge=` | A |
| `GET /api/repos/:ns/:repo` | B |
| `GET /api/repos/:ns/:repo/tags?page=&pageSize=&ordering=&name=` | C |
| `GET /api/publishers/:name` | D |

The proxy never forwards arbitrary paths or URLs.

### Param validation

Valibot schemas (`app/lib/params.ts`) and a `400` helper (`app/lib/validate.ts`) are available for every param. Route enforcement is not wired yet (RISKS.md 2.2/2.3); once a route calls `parseParams`/`parseOrThrow`, a failed parse returns `400` with `Cache-Control: no-store` and this body (messages never echo the input):

```json
{ "error": { "code": "invalid_params", "message": "Invalid request parameters",
             "issues": [{ "param": "page", "message": "page must be a whole number between 1 and 100" }] } }
```

| Our param | Rule | Default | Upstream |
|---|---|---|---|
| `:ns`, `:repo`, `:name` (publisher) | `^[a-z0-9]+(?:[._-][a-z0-9]+)*$`, ≤ 255 chars | | path segment, `encodeURIComponent` |
| `:tag` | `^[\w][\w.-]{0,127}$` (ASCII) | | path segment |
| `q` | trimmed, ≤ 100 chars, no control chars | `''` | `query` |
| `page` | integer 1–100 | `1` | search: `from = (page - 1) * pageSize`; tags: `page` |
| `pageSize` | integer 1–100 | `25` | search: `size`; tags: `page_size` |
| `sort` (search) | `relevance` \| `pulls` \| `stars` \| `updated` | `relevance` | `sort` omitted \| `pull_count` \| `star_count` \| `updated_at`, with `order=desc` |
| `badge` (search) | `official` \| `verified_publisher` \| `open_source` | none | `badges` |
| `ordering` (tags) | `last_updated` \| `-last_updated` \| `name` \| `-name` | none | `ordering` |
| `name` (tags) | trimmed, `[\w.-]*`, ≤ 128 chars | none | `name` |

Query strings: unknown keys are ignored, empty values count as missing, and a repeated key uses its first value.

## Upstream client (`app/server/dockerhub.server.ts`)

The only code that builds Docker Hub URLs. Callers pass a typed request (`search`, `suggestions`, `repository`, `tags`, `tag`, `org`, `user`) made from the validated param types above, plus a Valibot schema for the response. It never accepts a URL or path: path segments are re-checked against the `:ns`/`:repo`/`:tag` patterns and `encodeURIComponent`-ed, query values go through `URLSearchParams`, and the URL must stay on `DOCKERHUB_BASE_URL`.

| Aspect | Behavior |
|---|---|
| Request | `GET`, `Accept: application/json`, `User-Agent: registry-ui (+https://github.com/danielco1420/registry-challange)`, no auth, redirects not followed |
| Timeout | `UPSTREAM_TIMEOUT_MS` (default 8000) per attempt, covering headers and body |
| Retry | One retry (2 attempts max) on 429, 5xx, timeout, network error, or a 2xx that isn't JSON. Waits `Retry-After` (seconds or HTTP date) when sent, else 250–500 ms. A `Retry-After` over 3 s isn't waited for: the error is thrown at once with `retryAfterSeconds` |
| Not retried | 404, other 4xx/3xx, JSON that fails the schema |

Failures throw `UpstreamError` with a `kind` (plus `status` and `retryAfterSeconds` when known; messages never include the upstream body):

| Upstream result | `kind` |
|---|---|
| 404 (`{"message":"object not found","errinfo":{}}`) | `not_found` |
| 429 | `rate_limited` |
| 5xx, timeout, network error, other non-2xx (e.g. a Cloudflare 403 challenge), redirect | `unavailable` |
| 2xx with a non-JSON `Content-Type` or body (e.g. Cloudflare HTML), or JSON that fails the schema | `bad_payload` |

Caching (T09) and the proxy-wide upstream budget (T10) wrap this client; every attempt, retries included, will count against the budget.

## Re-verify (curl probes)

```bash
curl -s "https://hub.docker.com/api/search/v4?query=&badges=official&sort=pull_count&order=desc&size=10"
curl -s "https://hub.docker.com/v2/namespaces/fluent/repositories/fluent-bit"
curl -s "https://hub.docker.com/v2/namespaces/fluent/repositories/fluent-bit/tags?page_size=5&ordering=last_updated"
curl -s -D - -o /dev/null -H "Origin: http://localhost:5173" "https://hub.docker.com/v2/repositories/library/nginx/tags?page_size=1"   # shows rate-limit headers, no CORS
```
