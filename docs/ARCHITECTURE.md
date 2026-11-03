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
| Upstream client (`app/server/dockerhub.server.ts`, in place) | Docker Hub calls, timeouts, retries, Valibot parsing, typed `UpstreamError` | The only code that knows Docker Hub URLs; takes typed requests, never URLs or paths (see [API.md](API.md#upstream-client-appserverdockerhubserverts)) |

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

The cache mechanics live in `app/server/cache.server.ts`: `cache.get(key, { ttlMs }, fetcher)` returns `{ value, status, isStale, ageMs, refreshFailed }`, where `status` is `HIT`, `MISS` or `STALE` for the `X-Cache` header. Each entry's TTL gets ±10% jitter. A stale entry is served at once while one background refresh runs; a failed refresh keeps it (and sets `refreshFailed`), and only LRU eviction removes it. The module never calls Docker Hub or sets headers.

Routes and loaders don't use the cache directly: they call `getCached(key, ttlSeconds, fetcher)` from `app/server/upstream.server.ts`, which wires the cache, the upstream client and the proxy-wide budget (`app/server/budget.server.ts`, a sliding window of `UPSTREAM_BUDGET_PER_MIN` upstream attempts per 60 s, retries included; cache hits and single-flight followers don't count). It returns `{ value, status, ageMs, degraded }`. `degraded` is true when a stale value is served because the budget is exhausted or the key's last refresh failed; loaders pass it to the degraded banner. With no cached value and a failing or refused upstream call, it throws `UpstreamUnavailableError`, which `upstreamUnavailableResponse` turns into the 503. `cachedJson` sets `X-Cache`, `Age` and `Cache-Control` (`public, max-age=<ttl>` when fresh, `no-store` when stale).

## Loading, empty and error states

Shared components in `app/components/state/` (questionnaire C16, D25), all copy through `t()` under `state.*`:

- `Loading`: spinner with short text, `role="status"`.
- `Empty`: title, description and a required `action` (e.g. "Clear filters").
- `ErrorState`: `kind` is `not_found`, `repo_not_found`, `unavailable`, `rate_limited` or `unexpected`. The last three require a `retry` callback ("Try again"); every kind links back to Explore, and an optional `retryAfterSeconds` says when to retry.
- `DegradedBanner`: rendered by a view whose loader returned `degraded: true` (stale data, see Caching).

The root `ErrorBoundary` (`app/root.tsx`) renders `RouteErrorState`, which maps the thrown value with `classifyRouteError` (`app/lib/route-error.ts`). React Router replaces a thrown `Error` with a generic one in production, so page loaders don't let `UpstreamError` or `UpstreamUnavailableError` escape: they `throw toPageErrorResponse(error, { notFound })` (`app/server/pageError.server.ts`), a `data({ kind, retryAfterSeconds }, { status })` with `Retry-After` and `Cache-Control: no-store`:

| Error | Status | Kind |
|---|---|---|
| `UpstreamError` `not_found` | 404 | `not_found`, or `repo_not_found` on the repository page |
| `UpstreamError` `rate_limited` / `budget_exhausted`; `UpstreamUnavailableError` `budget_exhausted` | 429 | `rate_limited` |
| `UpstreamError` `unavailable` / `bad_payload`; `UpstreamUnavailableError` `upstream_failed` | 503 | `unavailable` |

Other thrown responses map by their `ApiErrorBody` code or status (an unmatched URL is React Router's 404, the per-client rate limit a 429), and anything else is `unexpected`. "Try again" revalidates the loaders after a thrown response and reloads the page after a render error.

## Styling

Tailwind CSS v4 through `@tailwindcss/vite`, with shadcn/ui components copied into `app/components/ui/` (`components.json` points the shadcn CLI there and at `~/lib/utils`). `app/app.css` holds the brand tokens as CSS variables for light (`:root`) and dark (`.dark` on `<html>`), mapped to Tailwind colors with `@theme inline`, so components use `bg-primary`, `text-brand`, `ring-ring` and so on instead of raw colors. It scans only `app/` for class names. `app/root.tsx` imports it; the production build links it as a file from `'self'`, so the CSP needs no `style-src` exception. Tokens are hex values so `app/lib/theme-contrast.test.ts` can check their WCAG contrast. Inline `style` attributes in server-rendered markup would be blocked by the production CSP, so components style with classes.

## Security headers

`app/server/securityHeaders.server.ts` (questionnaire G43, [RISKS](RISKS.md) 3.2/3.3) sets `Strict-Transport-Security`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin` and a Content Security Policy on everything the router answers:

| Response | CSP | Set by |
|---|---|---|
| HTML documents, including 404 and error pages | `default-src 'self'; script-src 'self' 'nonce-…'; img-src 'self' https://*.cloudfront.net https://www.gravatar.com; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'` | `app/entry.server.tsx`, with a fresh nonce per render |
| `/api/*` resource routes, `.data` requests | `default-src 'none'; frame-ancestors 'none'` | the root route's `middleware` (`future.v8_middleware`) |

The document's nonce goes to `<ServerRouter nonce>` and `renderToPipeableStream({ nonce })`; React Router passes it on to `<Scripts>`, `<ScrollRestoration>` and the streamed hydration scripts, so no route needs to handle it. Any inline `<script>` added later must take the nonce the same way, and a new image host goes into `IMAGE_HOSTS`. In `pnpm dev` only, `style-src` also allows `'unsafe-inline'`, because Vite injects CSS as `<style>` tags; production links CSS files from `'self'`. Static files that `react-router-serve` answers before the router (`/assets/*`, `public/`) and React Router's `/__manifest` route discovery JSON don't get these headers.
