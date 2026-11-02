# ADR-0003: Server-side cache and upstream failure handling

- **Status:** Accepted
- **Date:** 2026-11-02

## Context

Every user's traffic leaves from the proxy's IP, so we share one anonymous Docker Hub limit of ~180 req/min ([RISKS.md](../RISKS.md) 1.1, 1.2, 1.6). Docker Hub can also return 429, 5xx or a Cloudflare HTML page. Questionnaire B9, G42, G44 and G45.

## Decision

- **Cache:** in-memory LRU, bounded by `CACHE_MAX_ENTRIES`, with single-flight per key and stale-while-revalidate. TTLs: popular 10 min, search 1 min, repo 5 min, tags 2 min, publisher 1 h, each overridable by env var.
- **HTTP caching:** `/api/*` responses carry `Cache-Control` headers matching those TTLs.
- **Failures (429, 5xx, timeout, non-JSON):** one retry with backoff that honors `Retry-After`; then serve stale cache if we have it; the UI shows a degraded banner when data is stale or upstream is failing; with no cache, show the "Docker Hub unavailable" state.
- **Per-client rate limit:** 60 req/min per client IP on `/api/*` and direct page-loader requests, 429 with `Retry-After`. This only contains abuse by a single client; it does not protect the shared Docker Hub quota, since three clients could consume all of it.
- **Proxy-wide upstream budget:** at most 150 upstream req/min, set by `UPSTREAM_BUDGET_PER_MIN` (default 150, values above 150 are rejected at startup), below Docker Hub's ~180 req/min. Every upstream attempt counts, including retries. Cache hits and single-flight followers don't. When the budget is exhausted we make no upstream call and follow the failure path above:
  - **Stale entry available:** `/api/*` returns 200 with the stale body, `X-Cache: STALE` and `Cache-Control: no-store`, so downstream caches don't keep it. No `Retry-After`. The UI shows the degraded banner.
  - **No stale entry:** `/api/*` returns 503 with a JSON error body and `Cache-Control: no-store`; `Retry-After` is the number of seconds until the budget resets. The UI shows the "Docker Hub unavailable" state.
- **Anonymous only:** no Docker Hub token.

## Alternatives considered

- **Redis:** shared across instances, but we run a single container; an extra service isn't worth it.
- **No retry:** simpler, but transient 5xx would surface to users.
- **Optional PAT:** raises limits, but adds a secret to manage; caching keeps us under the anonymous limit.

## Consequences

- The cache is lost on restart and isn't shared if we ever run multiple instances (RISKS 2.7). Redis is the upgrade path.
- Stale data can be shown for a while during outages; the banner makes that visible.
