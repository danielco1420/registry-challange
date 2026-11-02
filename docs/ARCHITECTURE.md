# Architecture

> Stub. The concrete stack is filled in after [DESIGN_QUESTIONNAIRE.md](DESIGN_QUESTIONNAIRE.md) section A is answered.

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
| Upstream client | Docker Hub calls, timeouts, retries, Zod parsing | The only code that knows Docker Hub URLs |

## Data flow: Repository details

1. User opens `/r/{ns}/{repo}`.
2. UI requests `/api/repos/{ns}/{repo}` and `/api/repos/{ns}/{repo}/tags?page=1`.
3. Proxy validates params and checks the cache. On a miss, it calls upstream with single-flight.
4. The upstream JSON is parsed with Zod, normalized into DTOs, cached, and returned.
5. UI renders: skeleton, then content, or an error/empty state.

## Caching

| Route | TTL (proposed) |
|---|---|
| popular | 10 min |
| search | 1 min |
| repo | 5 min |
| tags | 2 min |
| publisher | 1 h |

Final values are decided in questionnaire B9.
