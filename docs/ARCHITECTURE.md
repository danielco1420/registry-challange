# Architecture

> Stack: React Router v7 framework mode, one Node app serving SSR pages and the `/api/*` proxy ([ADR-0002](adr/0002-react-router-v7-single-app.md)). Decisions: [DESIGN_QUESTIONNAIRE.md](DESIGN_QUESTIONNAIRE.md).

## Overview

```
┌──────────────┐   /api/*    ┌──────────────────────────┐   HTTPS   ┌──────────────────┐
│  Browser UI  │ ──────────► │  API proxy (BFF)         │ ────────► │  hub.docker.com  │
│  pages,      │ ◄────────── │  • route allowlist       │ ◄──────── │  /api/search/v4  │
│  components  │  DTO JSON   │  • param validation      │   JSON    │  /v2/namespaces  │
└──────────────┘             │  • cache + single-flight │           │  /v2/orgs|users  │
                             │  • rate limiting         │           └──────────────────┘
                             │  • normalization (DTOs)  │
                             └──────────────────────────┘
```

Why a proxy: Docker Hub sends no CORS headers. See [ADR-0001](adr/0001-backend-proxy-for-cors.md).

## Layers (planned)

| Layer | Responsibility | Rule |
|---|---|---|
| UI pages | Explore, Repository details | Read data only through hooks |
| Hooks / data layer | Server-state queries, URL state | Only calls our `/api/*` |
| API client (frontend) | Typed fetchers for `/api/*` | The only frontend code that does network calls |
| Proxy routes | Validate, cache, call upstream, normalize | Allowlist only (see [API.md](API.md#proxy-routes-allowlist-only)) |
| Upstream client | Docker Hub calls, timeouts, retries, Valibot parsing | The only code that knows Docker Hub URLs |

## Data flow: Repository details

1. User opens `/r/{ns}/{repo}`.
2. UI requests `/api/repos/{ns}/{repo}` and `/api/repos/{ns}/{repo}/tags?page=1`.
3. Proxy validates params and checks the cache. On a miss, it calls upstream with single-flight.
4. The upstream JSON is parsed with Valibot, normalized into DTOs, cached, and returned.
5. UI renders: skeleton, then content, or an error/empty state.

## Caching

| Route | TTL |
|---|---|
| popular | 10 min |
| search | 1 min |
| repo | 5 min |
| tags | 2 min |
| publisher | 1 h |

In-memory LRU with single-flight and stale-while-revalidate; TTLs overridable by env var. See [ADR-0003](adr/0003-server-cache-and-upstream-failures.md).

The cache mechanics live in `app/server/cache.server.ts`: `cache.get(key, { ttlMs }, fetcher)` returns `{ value, status, isStale, ageMs }`, where `status` is `HIT`, `MISS` or `STALE` for the `X-Cache` header. Each entry's TTL gets ±10% jitter. A stale entry is served at once while one background refresh runs; a failed refresh keeps it, and only LRU eviction removes it. The module never calls Docker Hub or sets headers: the upstream client passes its fetch as `fetcher`, and the routes map `status`/`ageMs` to headers.
