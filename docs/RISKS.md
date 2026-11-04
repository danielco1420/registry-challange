# Risks & mitigations

Status legend: ⬜ planned · 🟡 partial · ✅ in place · ➖ accepted (won't fix)

Update the status column as mitigations land. New risks go in the matching section.

## 1. External API (Docker Hub)

| # | Risk | Impact | Mitigation | Status |
|---|---|---|---|---|
| 1.1 | **Upstream rate limit** (~180 req/min per IP) is shared by every user, because all traffic leaves from the proxy's IP | 429s for everyone under modest load | Server-side cache with per-route TTLs; request coalescing (single-flight); stale-while-revalidate; honor `Retry-After`; proxy-wide budget of `UPSTREAM_BUDGET_PER_MIN` (≤150) upstream attempts per minute | ✅ (cache, budget and `getCached` facade in `app/server/{cache,budget,upstream}.server.ts`, used by every `/api/*` proxy route; upstream 404s are cached too) |
| 1.2 | **Cache stampede** when a hot key expires | Burst of upstream calls, which leads to 429s | Single-flight per key; jittered TTLs; serve stale while refreshing | ✅ (`app/server/cache.server.ts`, used by every `/api/*` proxy route) |
| 1.3 | **Undocumented `/api/search/v4`** changes or disappears | Search and Explore break | Valibot validation with clear errors; fallback to `/v2/search/repositories`; contract tests against recorded fixtures | 🟡 (schemas in `app/server/dockerhub.schemas.server.ts`; schema failures are `bad_payload` with the failing `issuePath`; legacy fallback in `app/server/search.server.ts` for non-empty, unfiltered queries; contract tests against `fixtures/dockerhub/`; used by `/api/search` and `/api/search/suggestions`, flagged by `source: "legacy"`) |
| 1.4 | **Cloudflare bot protection** challenges our server IP | Upstream returns HTML or 403 instead of JSON | Low request volume via caching; descriptive User-Agent; detect non-JSON responses and surface a degraded state | 🟡 (User-Agent and non-JSON detection in `app/server/dockerhub.server.ts`; `getCached` serves stale data with a `degraded` flag or a 503 in `app/server/upstream.server.ts`, answered by the `/api/*` routes as `X-Cache: STALE` or `503`; `DegradedBanner` and the "Docker Hub unavailable" state in `app/components/state/`, to be rendered by the page loaders) |
| 1.5 | **Terms of Service** for automated or undocumented API use | Access could be blocked | Keep traffic minimal, document the usage, prefer documented endpoints where they exist | ⬜ |
| 1.6 | **Upstream latency or outages** | Hanging requests, blank UI | Timeouts (~8 s); retry with backoff for GETs; serve stale cache; degraded-mode banner | 🟡 (timeout and one retry honoring `Retry-After` in `app/server/dockerhub.server.ts`; stale fallback and 503 in `app/server/upstream.server.ts`, wired into the `/api/*` routes; `DegradedBanner` and the "Docker Hub unavailable" state with a retry in `app/components/state/`, to be rendered by the page loaders) |

## 2. Our proxy: abuse & load

| # | Risk | Impact | Mitigation | Status |
|---|---|---|---|---|
| 2.1 | **Flooding / DoS of the proxy** (the Rack::Attack concern) | Proxy overload, and it also burns our upstream quota | Per-IP rate limit in the app (60 req/min, 429 + `Retry-After`); cap `pageSize` and `page` depth; small request body limits | 🟡 (per-client limiter in `app/server/rateLimit.server.ts`, applied to every `/api/*` route; page loaders not wired yet; `page` and `pageSize` capped at 100; off until `TRUST_PROXY_HOPS` is set, see 2.8. Fixed window, so a client can burst up to 2 × 60 across a window boundary) |
| 2.2 | **Open proxy / SSRF**: attacker makes us fetch arbitrary URLs | Abuse of our server | Allowlisted routes only; build upstream URLs from validated params; never forward user-supplied URLs or paths | 🟡 (param schemas in `app/lib/params.ts`; upstream client `app/server/dockerhub.server.ts` takes typed requests only, pins the origin and doesn't follow redirects; the `/api/*` routes in `app/routes.ts` are the allowlist, any other `/api/*` path answers 404) |
| 2.3 | **Path or parameter injection** (`../`, encoded slashes, huge strings) | Unexpected upstream calls, errors | Validate `namespace`/`repo` with `^[a-z0-9]+(?:[._-][a-z0-9]+)*$`, tags with `^[\w][\w.-]{0,127}$`; length limits; `encodeURIComponent` | 🟡 (schemas and 400 helper in `app/lib`; every `/api/*` route validates its params (400); the upstream client re-checks every segment and `encodeURIComponent`s it) |
| 2.4 | **Scrapers** using us as a free mirror | Quota exhaustion | Rate limits, cache headers, optional edge bot protection | 🟡 (per-client limit and `Cache-Control` on `/api/*`; no edge protection) |
| 2.5 | **Huge tag lists** (thousands of tags) | Slow pages, memory use | Server-side pagination; never fetch all pages; list virtualization if we use infinite scroll | 🟡 (`/api/repos/:ns/:repo/tags` serves one page, `pageSize` ≤ 100; UI pending) |
| 2.6 | **Unbounded in-memory cache** | Memory leak or crash | LRU with max entries; move to Redis if we scale horizontally | 🟡 (LRU bounded by `CACHE_MAX_ENTRIES` in `app/server/cache.server.ts`) |
| 2.7 | **Multiple instances** each hold their own cache | Lower hit rate, more upstream calls | Shared cache (Redis) or CDN caching via `Cache-Control` | ➖ until scaling |
| 2.8 | **Client IP spoofing** via `X-Forwarded-For` to dodge the per-client limit | Rate limit bypassed | Trust the header only when `TRUST_PROXY_HOPS` > 0, and then only the entry that many hops from the right (the app must be reachable only through those proxies); IPv6 bucketed by /64; tracked clients capped (10,000) with expired windows evicted. Without a trusted proxy the loader can't see the client IP, so those requests aren't limited (logged once) rather than sharing one bucket | 🟡 (`app/server/rateLimit.server.ts`; set `TRUST_PROXY_HOPS` per deployment) |

## 3. Frontend security & privacy

| # | Risk | Impact | Mitigation | Status |
|---|---|---|---|---|
| 3.1 | **XSS via `full_description` Markdown** (publisher-controlled) | Script execution in our origin | Render Markdown with a sanitizer (rehype-sanitize / DOMPurify); no raw HTML; links get `rel="noopener noreferrer nofollow"` | ⬜ |
| 3.2 | **Third-party images** (cloudfront logos, gravatar) | Tracking/referrer leakage, broken images | CSP `img-src` allowlist; `referrerpolicy="no-referrer"`; fallback avatar; optionally proxy images | 🟡 (CSP `img-src 'self' https://*.cloudfront.net https://www.gravatar.com` and `Referrer-Policy: strict-origin-when-cross-origin` in `app/server/securityHeaders.server.ts`, so other hosts' images are blocked and allowed ones get only our origin as referrer; per-image `referrerpolicy="no-referrer"` and the fallback avatar land with the UI. A new logo host needs adding to `IMAGE_HOSTS`) |
| 3.3 | **Missing security headers** | Clickjacking, MIME sniffing | CSP, HSTS, `X-Content-Type-Options: nosniff`, `frame-ancestors 'none'`, `Referrer-Policy: strict-origin-when-cross-origin` | ✅ (`app/server/securityHeaders.server.ts`: nonce-based CSP on documents from `app/entry.server.tsx`, including 404 and error pages; `default-src 'none'; frame-ancestors 'none'` on `/api/*` and `.data` responses from the root middleware; tested in `e2e/security-headers.spec.ts`. Static files (`/assets/*` and `public/`) and the `/__manifest` route discovery JSON are answered before the router's middleware and get none of these headers; `pnpm dev` allows inline styles) |
| 3.4 | **Secret leakage** | Account compromise | We call Docker Hub anonymously, so there is no token. Any future secret: server env var only, never in the client bundle or logs; `.env` gitignored | ➖ (no secrets) |
| 3.5 | **Supply chain** (malicious or vulnerable dependencies) | Compromise | Commit the lockfile; Dependabot; `audit` in CI; keep dependencies minimal | 🟡 (Dependabot config added; `pnpm audit --audit-level=high` runs in CI; dependency install scripts are opt-in via `allowBuilds` in `pnpm-workspace.yaml`) |

## 4. UX & correctness

| # | Risk | Mitigation | Status |
|---|---|---|---|
| 4.1 | `library/` namespace: wrong pull command or URL | `pullCommand()` helper strips `library/`; unit tests | ⬜ |
| 4.2 | Pull counts in mixed formats ("1B+" vs integer) | Normalize to `pulls` + `pullsLabel` in the proxy | ✅ (`normalizePulls` in `app/server/normalize.server.ts`, tested against every label in the fixtures; every `/api/*` DTO carries both) |
| 4.3 | Missing fields (no logo, empty description, `full_size` 0) | Fallback avatar, "No description" copy, "—" for unknown size | 🟡 (normalizers return `logoUrl` absent, `description: ""`, `size: 0`; `formatSize` renders "—"; UI fallbacks pending) |
| 4.4 | Clipboard API needs a secure context and a user gesture | Hidden `textarea` + `execCommand('copy')` fallback; show an error state if both fail | ⬜ |
| 4.5 | Stale responses overwrite newer ones when typing fast | Query keys / AbortController; debounce | ✅ (autocomplete in `app/components/search/use-suggestions.ts`: 250 ms debounce, one `AbortController` per request, aborted when the query moves on or on unmount, and results keyed by query so a late older answer is never shown; race test in `app/components/search/search-bar.test.tsx`) |
| 4.6 | Time zones and relative-date drift | Format with `Intl`; show the absolute date in a tooltip | ⬜ |
| 4.7 | Deleted or private repos return 404 (archived ones return 200 with `status_description: "archived"`) | Friendly not-found page with a link back to Explore; `archived` flag on the DTOs for an "Archived" label | 🟡 (`/api/repos/*` and `/api/publishers/:name` answer a JSON `404`; `archived` on the DTOs; pages pending) |
| 4.8 | Accessibility regressions | best-effort accessibility (no formal WCAG target, see E30): semantic HTML, Radix primitives, visible focus rings, keyboard nav; `aria-live` on copy feedback; axe checks in e2e | 🟡 (app shell: skip link, `banner` / `main` / `contentinfo` landmarks, a base `:focus-visible` ring in the contrast-checked `--ring` color, a labelled theme toggle with `aria-pressed`; covered by `e2e/app-shell.spec.ts`. Search box: a labelled `search` landmark and WAI-ARIA combobox with arrow-key navigation, Escape to close and a polite live region for suggestion counts; covered by `app/components/search/search-bar.test.tsx` and `e2e/search.spec.ts`. No axe checks yet) |
