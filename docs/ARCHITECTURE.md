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

1. User opens `/r/{ns}/{repo}` (or `/_/{repo}` for an official image; `/r/library/{repo}[/…]` answers a 301 to it, query kept).
2. The page's layout loader (`app/routes/repo.tsx` → `loadRepoPage` in `app/server/repo.server.ts`) applies the per-client rate limit, validates the names (an invalid one is "repository not found", with no upstream call) and reads the details through `getCached` with the **same cache key** as `/api/repos/{ns}/{repo}`, so the page and the proxy route share one entry. The Tags tab will fetch `/api/repos/{ns}/{repo}/tags` (T25).
3. On a miss, the upstream client calls Docker Hub with single-flight.
4. The upstream JSON is parsed with Valibot, normalized into DTOs, cached, and returned.
5. UI renders the content, or an error/empty state (see "Repository page" below).

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

The root `ErrorBoundary` (`app/root.tsx`) renders `RouteErrorState`, which maps the thrown value with `classifyRouteError` (`app/lib/route-error.ts`). React Router replaces a thrown `Error` with a generic one in production, so page loaders don't let `UpstreamError` or `UpstreamUnavailableError` escape: they `throw toPageErrorResponse(error)` (`app/server/pageError.server.ts`), a `data({ kind, retryAfterSeconds }, { status })` with `Retry-After` and `Cache-Control: no-store`. The root `headers` export passes those two headers on to the document (React Router otherwise copies only a thrown response's cookies). The mapping matches the `/api/*` routes and ADR-0003:

| Thrown | Status | Kind |
|---|---|---|
| `UpstreamUnavailableError` (Docker Hub failing or budget spent, nothing cached) | 503 | `unavailable` |
| `UpstreamError` that escaped `getCached` / `orNotFound` (e.g. an unexpected upstream 404) | 503 | `unavailable` |
| The per-client 429 from `enforceRateLimit` | 429 | `rate_limited` (with its `Retry-After` seconds) |

A missing resource is cached like any other answer: the loader reads `getCached(key, ttl, () => orNotFound(load()))` and throws `pageNotFound('repo_not_found')` (a 404) when the value is `null`, so repeated misses don't spend the upstream budget. Other thrown responses map by their `ApiErrorBody` code or status (an unmatched URL is React Router's 404), and anything else is `unexpected`. "Try again" revalidates the loaders after a thrown response and reloads the page after a render error.

## Repository components

Shared by Explore and the repository page (questionnaire D22, D27; [RISKS](RISKS.md) 3.2, 4.3, 4.4), all copy through `t()` under `repo.*` and `copy.*`:

- `RepoCard` (`app/components/repo/repo-card.tsx`): logo, name, owner, description ("No description" when empty) and badge. The name is the only link (to `repoPath()` in `app/lib/repo-path.ts`: `/_/{repo}` for official images, `/r/{ns}/{repo}` otherwise), stretched over the card, so each card is one tab stop.
- `RepoBadge` (`app/components/repo/repo-badge.tsx`) on the shadcn `Badge` (`app/components/ui/badge.tsx`): "Official Image", "Verified Publisher", "Sponsored OSS", "Hardened Image"; nothing for `none`.
- `RepoLogo` (`app/components/repo/repo-logo.tsx`): logo, then the publisher's avatar, then initials (`app/lib/initials.ts`). Images get `referrerpolicy="no-referrer"` and `alt=""` (the name is always beside them). The server renders the logo, or the initials when there's none. The avatar lookup (`GET /api/publishers/:name`) runs in the browser, and only when the logo is missing or fails to load. Lookups are shared per publisher across the page (`use-publisher-avatar.ts`; a failed one is retried by the next mount), and the initials show while one is pending or after it fails. A caller that already has `Publisher.avatarUrl` passes it as `avatarUrl` (`null` for none) and no lookup happens. A logo that broke before hydration (`complete` with `naturalWidth` 0, and `decode()` rejects, so an SVG without intrinsic size isn't mistaken for a broken one) also counts as failed.
- `CopyButton` (`app/components/copy/copy-button.tsx`): `navigator.clipboard.writeText`, then "Copied ✓" for 2 s and "Copied to clipboard." in a polite live region. When the Clipboard API is missing (insecure context) or rejects, a read-only input with the text appears, focused and selected, and the live region says to press Ctrl+C.
- `RepoHeader` (`app/components/repo/repo-header.tsx`): the repository page's header. Logo, name (the page's `h1`), owner (skipped for official images), description, badge, "Archived", last updated (relative, absolute on hover), pulls and stars.

## Repository page

Routes (questionnaire C14, D24): `r/:ns/:repo` and `_/:repo` in `app/routes.ts` share one layout module (`app/routes/repo.tsx`) under distinct route ids, each with an Overview index child (`repo._index.tsx`) and a `tags` child (`repo.tags.tsx`, a placeholder until T25). The layout renders `RepoHeader`, the "Overview | Tags" `nav` (`NavLink`s, so the current tab gets `aria-current="page"`) and the tab, which reads the repository from `<Outlet context>` (`useRepoPage()`, `app/components/repo/repo-page-context.ts`). Switching tabs loads nothing; leaving for another repository shows `Loading` in place of the tab.

States: a missing repository or an invalid name is "repository not found" (404); Docker Hub failing with nothing cached is "unavailable" (503) and the per-client limit "rate limited" (429), all thrown as page errors and rendered by the root `ErrorBoundary`. A stale copy renders with the `DegradedBanner`. An empty `full_description` shows an `Empty` state pointing to the Tags tab.

Overview Markdown goes through `Markdown` (`app/components/markdown/markdown.tsx`; [RISKS](RISKS.md) 3.1): `react-markdown` with `remark-gfm` and `rehype-sanitize` (GitHub's schema). Raw HTML in the source is skipped, never parsed. URLs pass `safeUrl` (`app/lib/safe-url.ts`): links keep only `https:`, `http:` and `mailto:`, images only `https:`; anything else, including relative URLs, is dropped. Links get `rel="noopener noreferrer nofollow"`; images are lazy, sent no referrer and capped at the column width (the CSP's `img-src` still blocks hosts outside `IMAGE_HOSTS`, so e.g. `raw.githubusercontent.com` images don't load). Headings shift down one level under the page's `h1`. Long words wrap, and code blocks and tables scroll inside their own box, so a large README can't widen the page.

## Styling

Tailwind CSS v4 through `@tailwindcss/vite`, with shadcn/ui components copied into `app/components/ui/` (`components.json` points the shadcn CLI there and at `~/lib/utils`). `app/app.css` holds the brand tokens as CSS variables for light (`:root`) and dark (`.dark` on `<html>`, repeated under `prefers-color-scheme: dark` for System, see below), mapped to Tailwind colors with `@theme inline`, so components use `bg-primary`, `text-brand`, `ring-ring` and so on instead of raw colors. It scans only `app/` for class names. `app/root.tsx` imports it; the production build links it as a file from `'self'`, so the CSP needs no `style-src` exception. Tokens are hex values so `app/lib/theme-contrast.test.ts` can check their WCAG contrast. Inline `style` attributes in server-rendered markup would be blocked by the production CSP, so components style with classes.

## App shell and theme

`Layout` in `app/root.tsx` wraps every page, error pages included, in `AppShell` (`app/components/layout/app-shell.tsx`): a skip link to `#main`, the header (brand link, an empty `data-slot="header-search"` slot for the header search, the theme toggle), `<main id="main">` and the footer. Pages render their content only, never their own `<main>`.

The theme (questionnaire D19, B8) is server-rendered so it never flashes:

1. The `theme` cookie (`app/server/theme.server.ts`: `light` or `dark`, `HttpOnly`, `SameSite=Lax`, one year; absent means System) is read by the root `loader`.
2. `Layout` sets `<html class="light">` or `class="dark"` from it (`themeClassName` in `app/lib/theme.ts`), and no class for System.
3. `app/app.css` applies the dark tokens under `.dark`, and also under `@media (prefers-color-scheme: dark)` for `:root:not(.light)`. The browser resolves System from the OS before first paint and follows OS changes live, with no inline script and no change to the CSP. The `dark:` Tailwind variant matches both cases. `app/lib/theme-contrast.test.ts` checks the two dark blocks stay identical.
4. The toggle (`app/components/theme/theme-toggle.tsx`) posts `theme` to `POST /theme` (`app/routes/theme.ts`, Valibot-validated, sets or deletes the cookie) through a fetcher with a shared key. `useTheme` reads the pending submission first, so `<html>` and the toggle update at once; the root loader then revalidates with the new cookie. Without JavaScript the buttons submit a plain form with `redirectTo`, and the action answers a 303 back to that same-origin path. That native post hits the resource route directly, which React Router's own `Origin` check for actions doesn't cover, so the action checks `Origin` itself and answers `403` to a cross-origin post. It compares against `PUBLIC_ORIGIN` when set (needed behind a TLS-terminating proxy, where the request URL is `http://`), else against the request URL's origin; `X-Forwarded-*` headers are never trusted for it. `PUBLIC_ORIGIN` only helps that native post: the fetcher posts to `/theme.data`, where React Router's own check runs first against the request URL, so behind a TLS-terminating proxy the JavaScript toggle is still refused with a `400`. Fixing that means the server must see the public URL (a custom server with a trusted proxy, or `allowedActionOrigins`), not decided yet.
5. Since the HTML depends on the cookie, `entry.server.tsx` adds `Vary: Cookie` to every page.

## Security headers

`app/server/securityHeaders.server.ts` (questionnaire G43, [RISKS](RISKS.md) 3.2/3.3) sets `Strict-Transport-Security`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin` and a Content Security Policy on everything the router answers:

| Response | CSP | Set by |
|---|---|---|
| HTML documents, including 404 and error pages | `default-src 'self'; script-src 'self' 'nonce-…'; img-src 'self' https://*.cloudfront.net https://www.gravatar.com; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'` | `app/entry.server.tsx`, with a fresh nonce per render |
| `/api/*` resource routes, `.data` requests | `default-src 'none'; frame-ancestors 'none'` | the root route's `middleware` (`future.v8_middleware`) |

The document's nonce goes to `<ServerRouter nonce>` and `renderToPipeableStream({ nonce })`; React Router passes it on to `<Scripts>`, `<ScrollRestoration>` and the streamed hydration scripts, so no route needs to handle it. Any inline `<script>` added later must take the nonce the same way, and a new image host goes into `IMAGE_HOSTS`. In `pnpm dev` only, `style-src` also allows `'unsafe-inline'`, because Vite injects CSS as `<style>` tags; production links CSS files from `'self'`. Static files that `react-router-serve` answers before the router (`/assets/*`, `public/`) and React Router's `/__manifest` route discovery JSON don't get these headers.
