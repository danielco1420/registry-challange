# Risks & mitigations

Status legend: ⬜ planned · 🟡 partial · ✅ in place · ➖ accepted (won't fix)

Update the status column as mitigations land. New risks go in the matching section.

## 1. External API (Docker Hub)

| # | Risk | Impact | Mitigation | Status |
|---|---|---|---|---|
| 1.1 | **Upstream rate limit** (~180 req/min per IP) is shared by every user, because all traffic leaves from the proxy's IP | 429s for everyone under modest load | Server-side cache with per-route TTLs; request coalescing (single-flight); stale-while-revalidate; honor `Retry-After`; proxy-wide budget of `UPSTREAM_BUDGET_PER_MIN` (≤150) upstream attempts per minute | 🟡 (cache, budget and `getCached` facade in `app/server/{cache,budget,upstream}.server.ts`; routes not wired yet, T13) |
| 1.2 | **Cache stampede** when a hot key expires | Burst of upstream calls, which leads to 429s | Single-flight per key; jittered TTLs; serve stale while refreshing | 🟡 (`app/server/cache.server.ts`; routes not wired yet) |
| 1.3 | **Undocumented `/api/search/v4`** changes or disappears | Search and Explore break | Valibot validation with clear errors; fallback to `/v2/search/repositories`; contract tests against recorded fixtures | ⬜ |
| 1.4 | **Cloudflare bot protection** challenges our server IP | Upstream returns HTML or 403 instead of JSON | Low request volume via caching; descriptive User-Agent; detect non-JSON responses and surface a degraded state | 🟡 (User-Agent and non-JSON detection in `app/server/dockerhub.server.ts`; `getCached` serves stale data with a `degraded` flag or a 503 in `app/server/upstream.server.ts`; routes and banner pending) |
| 1.5 | **Terms of Service** for automated or undocumented API use | Access could be blocked | Keep traffic minimal, document the usage, prefer documented endpoints where they exist | ⬜ |
| 1.6 | **Upstream latency or outages** | Hanging requests, blank UI | Timeouts (~8 s); retry with backoff for GETs; serve stale cache; degraded-mode banner | 🟡 (timeout and one retry honoring `Retry-After` in `app/server/dockerhub.server.ts`; stale fallback and 503 in `app/server/upstream.server.ts`; routes and banner pending) |

## 2. Our proxy: abuse & load

| # | Risk | Impact | Mitigation | Status |
|---|---|---|---|---|
| 2.1 | **Flooding / DoS of the proxy** (the Rack::Attack concern) | Proxy overload, and it also burns our upstream quota | Per-IP rate limit in the app (60 req/min, 429 + `Retry-After`); cap `pageSize` and `page` depth; small request body limits | 🟡 (per-client limiter in `app/server/rateLimit.server.ts`; routes and loaders not wired yet, T13; off until `TRUST_PROXY_HOPS` is set, see 2.8. Fixed window, so a client can burst up to 2 × 60 across a window boundary) |
| 2.2 | **Open proxy / SSRF**: attacker makes us fetch arbitrary URLs | Abuse of our server | Allowlisted routes only; build upstream URLs from validated params; never forward user-supplied URLs or paths | 🟡 (param schemas in `app/lib/params.ts`; upstream client `app/server/dockerhub.server.ts` takes typed requests only, pins the origin and doesn't follow redirects; routes not wired yet) |
| 2.3 | **Path or parameter injection** (`../`, encoded slashes, huge strings) | Unexpected upstream calls, errors | Validate `namespace`/`repo` with `^[a-z0-9]+(?:[._-][a-z0-9]+)*$`, tags with `^[\w][\w.-]{0,127}$`; length limits; `encodeURIComponent` | 🟡 (schemas and 400 helper in `app/lib`; the upstream client re-checks every segment and `encodeURIComponent`s it; routes not wired yet) |
| 2.4 | **Scrapers** using us as a free mirror | Quota exhaustion | Rate limits, cache headers, optional edge bot protection | ⬜ |
| 2.5 | **Huge tag lists** (thousands of tags) | Slow pages, memory use | Server-side pagination; never fetch all pages; list virtualization if we use infinite scroll | ⬜ |
| 2.6 | **Unbounded in-memory cache** | Memory leak or crash | LRU with max entries; move to Redis if we scale horizontally | 🟡 (LRU bounded by `CACHE_MAX_ENTRIES` in `app/server/cache.server.ts`; routes not wired yet) |
| 2.7 | **Multiple instances** each hold their own cache | Lower hit rate, more upstream calls | Shared cache (Redis) or CDN caching via `Cache-Control` | ➖ until scaling |
| 2.8 | **Client IP spoofing** via `X-Forwarded-For` to dodge the per-client limit | Rate limit bypassed | Trust the header only when `TRUST_PROXY_HOPS` > 0, and then only the entry that many hops from the right (the app must be reachable only through those proxies); IPv6 bucketed by /64; tracked clients capped (10,000) with expired windows evicted. Without a trusted proxy the loader can't see the client IP, so those requests aren't limited (logged once) rather than sharing one bucket | 🟡 (`app/server/rateLimit.server.ts`; set `TRUST_PROXY_HOPS` per deployment) |

## 3. Frontend security & privacy

| # | Risk | Impact | Mitigation | Status |
|---|---|---|---|---|
| 3.1 | **XSS via `full_description` Markdown** (publisher-controlled) | Script execution in our origin | Render Markdown with a sanitizer (rehype-sanitize / DOMPurify); no raw HTML; links get `rel="noopener noreferrer nofollow"` | ⬜ |
| 3.2 | **Third-party images** (cloudfront logos, gravatar) | Tracking/referrer leakage, broken images | CSP `img-src` allowlist; `referrerpolicy="no-referrer"`; fallback avatar; optionally proxy images | ⬜ |
| 3.3 | **Missing security headers** | Clickjacking, MIME sniffing | CSP, HSTS, `X-Content-Type-Options: nosniff`, `frame-ancestors 'none'`, `Referrer-Policy: strict-origin-when-cross-origin` | ⬜ |
| 3.4 | **Secret leakage** | Account compromise | We call Docker Hub anonymously, so there is no token. Any future secret: server env var only, never in the client bundle or logs; `.env` gitignored | ➖ (no secrets) |
| 3.5 | **Supply chain** (malicious or vulnerable dependencies) | Compromise | Commit the lockfile; Dependabot; `audit` in CI; keep dependencies minimal | 🟡 (Dependabot config added) |

## 4. UX & correctness

| # | Risk | Mitigation | Status |
|---|---|---|---|
| 4.1 | `library/` namespace: wrong pull command or URL | `pullCommand()` helper strips `library/`; unit tests | ⬜ |
| 4.2 | Pull counts in mixed formats ("1B+" vs integer) | Normalize to `pulls` + `pullsLabel` in the proxy | ⬜ |
| 4.3 | Missing fields (no logo, empty description, `full_size` 0) | Fallback avatar, "No description" copy, "—" for unknown size | ⬜ |
| 4.4 | Clipboard API needs a secure context and a user gesture | Hidden `textarea` + `execCommand('copy')` fallback; show an error state if both fail | ⬜ |
| 4.5 | Stale responses overwrite newer ones when typing fast | Query keys / AbortController; debounce | ⬜ |
| 4.6 | Time zones and relative-date drift | Format with `Intl`; show the absolute date in a tooltip | ⬜ |
| 4.7 | Archived, deleted or private repos return 404 | Friendly not-found page with a link back to Explore | ⬜ |
| 4.8 | Accessibility regressions | best-effort accessibility (no formal WCAG target, see E30): semantic HTML, Radix primitives, visible focus rings, keyboard nav; `aria-live` on copy feedback; axe checks in e2e | ⬜ |
