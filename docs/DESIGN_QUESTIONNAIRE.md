# Design questionnaire

We go through these one at a time. For each question:
- fill in **Answer**,
- add a short **Why** if it isn't obvious,
- if a decision is significant, record it as an ADR in [adr/](adr/).

*Rec* is the starting suggestion, not a decision.

Status legend: ⬜ open · ✅ decided

All questions answered on 2026-11-02. Significant decisions are recorded in [ADR-0002](adr/0002-react-router-v7-single-app.md) (stack) and [ADR-0003](adr/0003-server-cache-and-upstream-failures.md) (caching and upstream failures).

---

## A. Architecture & stack

### A1. ✅ Backend proxy form
A proxy is required because Docker Hub has no CORS headers ([ADR-0001](adr/0001-backend-proxy-for-cors.md)).
Options: Next.js route handlers · Node + Express · Node + Fastify · serverless function (Vercel/Netlify) · Vite dev proxy only (local-only; not deployable).
*Rec:* Next.js route handlers, or Vite + a small Fastify server.
**Answer:** React Router v7 (framework mode) resource routes serve `/api/*` from the same Node server as the UI.
**Why:** One deployable; server loaders can reuse the same upstream client and cache directly. See [ADR-0002](adr/0002-react-router-v7-single-app.md).

### A2. ✅ Frontend framework
Options: React · Vue · Svelte · Angular.
*Rec:* React.
**Answer:** React.

### A3. ✅ Meta-framework vs SPA
Options: Next.js (App Router, SSR) · Remix/React Router · Vite SPA.
Consider SSR/SEO for repo pages and whether the proxy lives in the same app.
**Answer:** React Router v7 framework mode, with SSR.
**Why:** SSR for shareable repo pages, web-standard loaders/actions, and the proxy lives in the same app.

### A4. ✅ TypeScript strict mode
*Rec:* yes, `strict: true`.
**Answer:** `strict: true` plus `noUncheckedIndexedAccess`.

### A5. ✅ Repo layout
Options: single app · pnpm workspace (`apps/web`, `apps/api`, `packages/shared`).
*Rec:* single app, unless the proxy is a separate server.
**Answer:** Single app. Server-only code lives in `*.server.ts` modules so it never reaches the client bundle.

### A6. ✅ Package manager & Node version
Options: pnpm · npm · yarn. Node LTS version pinned in `.nvmrc`.
*Rec:* pnpm, Node 22 LTS.
**Answer:** pnpm (pinned via `packageManager` in `package.json`), Node 22 LTS in `.nvmrc`.

---

## B. Data fetching & state

### B7. ✅ Server-state library
Options: TanStack Query · SWR · RTK Query · plain fetch.
*Rec:* TanStack Query.
**Answer:** None. React Router loaders for page data, `useFetcher` for "Load more" and autocomplete.
**Why:** Loaders already handle fetching, revalidation and pending states; caching lives on the server (B9).

### B8. ✅ Client state (theme, recent searches, favorites)
Options: none (URL + localStorage) · React Context · Zustand.
**Answer:** No state library. URL for view state (B13), small hooks around `localStorage` for recent searches and favorites, theme in a cookie so SSR renders the right theme without a flash (done in T17, see D19).

### B9. ✅ Server-side caching
Options: in-memory LRU · Redis · HTTP `Cache-Control` + CDN · a combination.
TTLs to set: popular (≈10 min) · search (≈1 min) · repo (≈5 min) · tags (≈2 min) · publisher (≈1 h).
**Answer:** In-memory LRU (max entries from `CACHE_MAX_ENTRIES`) with single-flight per key and stale-while-revalidate, plus `Cache-Control` headers on `/api/*` responses. TTLs as listed: popular 10 min, search 1 min, repo 5 min, tags 2 min, publisher 1 h (configurable via env). See [ADR-0003](adr/0003-server-cache-and-upstream-failures.md).

### B10. ✅ Runtime validation of upstream responses
Zod schemas protect against changes to the undocumented API.
*Rec:* yes.
**Answer:** Yes, with **Valibot** instead of Zod. Used for upstream responses and for our own route params.
**Why:** Same safety, smaller and tree-shakeable, so the shared schemas stay cheap if any reach the client.

### B11. ✅ Search interaction
Options: debounced as-you-type · submit-only · both. Autocomplete via `/api/search/v4/suggestions`?
**Answer:** Submit navigates to the results page. A debounced (~250 ms) autocomplete dropdown uses `/api/search/v4/suggestions` through a new allowlisted proxy route.
**Follow-up:** add the suggestions route to the allowlist in [API.md](API.md) and the hard rules when implemented. Done: `GET /api/search/suggestions?q=` (T13).

### B12. ✅ Pagination style
Separately for search results and for tags. Options: numbered pages · "Load more" · infinite scroll.
**Answer:** Search results: numbered pages (`page` in the URL). Tags: "Load more".

### B13. ✅ URL as state
Put `q`, `sort`, `page`, and the tag filter in the query string, so links can be shared and Back/Forward works.
*Rec:* yes.
**Answer:** Yes.

---

## C. Routing & URLs

### C14. ✅ URL scheme
Options: mirror Hub (`/r/{ns}/{repo}`, `/_/{repo}` for official images) · `/repo/{ns}/{repo}`.
**Answer:** Mirror Hub: `/r/{ns}/{repo}`, and `/_/{repo}` for official images (`/r/library/{repo}` redirects to it).

### C15. ✅ Deep-linkable tag view
`/r/{ns}/{repo}/tags/{tag}` (uses the single-tag endpoint)?
**Answer:** Yes. Shows digest, pull commands and the per-architecture breakdown.

### C16. ✅ 404 and error pages
Custom design? Separate states for "repo not found" and "Docker Hub unavailable"?
**Answer:** Distinct states: generic 404, "repository not found", and "Docker Hub unavailable / rate limited" with a retry action.

---

## D. UI & visual design

### D17. ✅ Component library
Options: shadcn/ui (Radix) + Tailwind · MUI · Chakra · Mantine · custom.
**Answer:** shadcn/ui (Radix primitives).

### D18. ✅ Styling approach
Options: Tailwind · CSS Modules · CSS-in-JS.
**Answer:** Tailwind CSS v4.

### D19. ✅ Dark mode
Options: system preference only · toggle · both (toggle that defaults to system).
**Answer:** Toggle with Light / Dark / System, defaulting to System. Stored in a cookie (see B8).
**Follow-up:** Done (T17). The `theme` cookie holds `light` or `dark`; System is the default, so choosing it deletes the cookie. The root loader reads it and the server renders `<html class="light|dark">`. System has no class: `app/app.css` applies the dark tokens under `@media (prefers-color-scheme: dark)` for `:root:not(.light)`, so the browser resolves it before first paint, with no inline script (and no CSP change). The toggle posts to `POST /theme` (`app/routes/theme.ts`) through a fetcher, with an optimistic update, and falls back to a plain form without JavaScript.

### D20. ✅ Brand
Palette (Docker-like blue or our own)? Typeface? Logo or name for the app?
**Answer:** App name **Danny's Dockers**. Neutral grays with a light green accent instead of Docker blue. No Docker logo or trademarks.
**Follow-up:** check the green accent's contrast against both themes for text and focus rings. Done (T16): tokens in `app/app.css`. The light green (`--primary`, #86efac light / #4ade80 dark) is a fill with dark green text on it (10.6:1 / 8.6:1). It's only 1.4:1 on white, so light mode uses a darker green, `--brand` #15803d, for green text and the focus ring (5.0:1 on the background, 4.6:1 on muted surfaces); dark mode uses #4ade80 (11.4:1 on the background, 8.7:1 on muted). `app/lib/theme-contrast.test.ts` checks the token pairs the UI uses, plus Button's translucent hover fills over the page and card, in both themes against AA (4.5:1 text, 3:1 focus rings). Light-mode `--destructive` is #b91c1c so white text keeps 4.5:1 on its 90% hover fill.

### D21. ✅ Explore layout
Options: card grid · list rows. Columns per breakpoint (e.g. 1 / 2 / 3 / 4)?
**Answer:** Card grid everywhere (popular and search results). Columns 2 / 3 / 4 from `md` / `lg` / `xl` (see E29 for the minimum width).

### D22. ✅ Card contents
Choose from: logo · name · owner · description · badge · pulls · stars · updated · arch chips.
**Answer:** Logo, name, owner, description. Plus the official / verified badge (from E28).
**Why:** Keeps cards clean; stats live on the repository page.
**Follow-up:** Done (T19): `RepoCard`, `RepoLogo` and `RepoBadge` in `app/components/repo/`. The badge also labels the DTO's other values ("Sponsored OSS", "Hardened Image"), since they come with the same data. A missing logo falls back to the publisher avatar, looked up in the browser through `/api/publishers/:name` only when needed, then to initials.

### D23. ✅ Tags layout
Options: table with sortable columns · cards. Expandable row for the per-architecture breakdown?
**Answer:** Table with sortable columns (name, last updated, size). Rows expand to show the per-architecture breakdown (OS/arch, digest, size).

### D24. ✅ Repository overview
Render `full_description` Markdown (sanitized)? Tabs "Overview | Tags" like Hub, or a single page?
**Answer:** Tabs "Overview | Tags", each URL-addressable (`/r/{ns}/{repo}` and `/r/{ns}/{repo}/tags`). Overview renders sanitized `full_description` Markdown.
**Follow-up:** Done (T24): `app/routes/repo.tsx` and its tabs, the same for `/_/{repo}`. The renderer is `react-markdown` + `remark-gfm` + `rehype-sanitize` (this questionnaire named none; RISKS 3.1 names `rehype-sanitize`). Raw HTML in a README is skipped rather than rendered, so HTML-only layout (e.g. `<p align="center">`) is lost; images from hosts outside the CSP `img-src` allowlist don't load. See [ARCHITECTURE](ARCHITECTURE.md#repository-page).

### D25. ✅ Loading, empty and error states
Skeletons or spinners? Illustrations? Copy text for each state?
**Answer:** Spinners with short text. No illustrations. Every data view has a loading, empty and error state with a clear next action (retry, clear filters).

### D26. ✅ Formatting
- Dates: relative ("3 days ago") with absolute on hover?
- Sizes: MB (decimal) or MiB (binary)?
- Numbers: compact (1.2B)?

**Answer:** Relative dates with the absolute date on hover; decimal units (MB, like Hub); compact numbers (1.2B). All via `Intl`.

### D27. ✅ Copy-command feedback
Options: inline "Copied ✓" · toast. Fallback when the Clipboard API isn't available?
**Answer:** Inline: the button shows "Copied ✓" for ~2 s, announced through `aria-live`. Fallback: select the command in a read-only input so the user can copy it manually.
**Follow-up:** Done (T19): `CopyButton` (`app/components/copy/copy-button.tsx`). The fallback also covers a rejected `writeText` (for example, permission denied), not just a missing Clipboard API. No `execCommand('copy')`: it's deprecated, and the selected input already does the job.

---

## E. Product extras ("Product Thinking" in the brief)

### E28. ✅ Which extras make the cut?
Tick the ones we're building:
- [x] Tag name filter (upstream `name=`) and sort (`ordering=`)
- [x] Copy pull-by-digest command
- [ ] Architecture / OS chips
- [x] Official / verified publisher badges
- [x] Recent searches (localStorage)
- [x] Favorites (localStorage)
- [ ] `/` keyboard shortcut to focus search
- [ ] "View on Docker Hub" link
- [ ] Pulls and stars stats
- [x] Tag deep links
- [x] Sort search results (relevance / pulls / stars / updated)
- [x] Badge filter on search
- [x] Autocomplete suggestions
- [x] Per-architecture size breakdown

**Answer / notes:** Per-architecture breakdown is in because the expandable tag rows (D23) and the tag page (C15) depend on it. Favorites show on Explore.

### E29. ✅ Responsive strategy
Mobile-first or desktop-first? Minimum supported width (e.g. 360 px)?
**Answer:** Desktop-first, minimum supported width 768 px. Narrower screens should still work but aren't polished.

### E30. ✅ Accessibility target
WCAG 2.1 AA? Full keyboard navigation, focus rings, `aria-live` on copy feedback?
*Rec:* AA.
**Answer:** Best effort, no formal target: semantic HTML, Radix primitives, visible focus rings, `aria-live` on copy feedback.

### E31. ✅ Internationalization
English only, or i18n-ready (message catalog, `Intl` formatting)?
**Answer:** i18n-ready with **react-i18next**. English catalog only for now; dates and numbers through `Intl`.

### E32. ✅ Analytics
None · privacy-friendly (Plausible/Umami).
**Answer:** None.

---

## F. Quality & delivery

### F33. ✅ Testing
- Unit: Vitest + Testing Library?
- API mocks: MSW?
- End-to-end: Playwright?
- Coverage target?

**Answer:** Vitest + Testing Library for unit/component tests, MSW with recorded Docker Hub fixtures, Playwright for a few end-to-end flows. Coverage target ~80% on server and lib code; no global gate on UI components.

### F34. ✅ Lint & format
Options: ESLint + Prettier · Biome. Pre-commit hooks with Husky + lint-staged?
**Answer:** ESLint + Prettier, with Husky + lint-staged pre-commit hooks.

### F35. ✅ Commit convention
Conventional Commits enforced by commitlint?
*Rec:* yes (already in [CONTRIBUTING.md](../CONTRIBUTING.md)).
**Answer:** Yes, commitlint on the `commit-msg` hook.

### F36. ✅ Branch strategy
Trunk-based with short-lived branches and PRs into `main`? Squash merges?
**Answer:** Trunk-based with short-lived branches and PRs into `main`. **Merge commits** (no squash), so branch history is kept.

### F37. ✅ CI checks
GitHub Actions on every PR: lint · typecheck · test · build · `audit`?
**Answer:** GitHub Actions on every PR: lint, typecheck, test, build, `pnpm audit` (high and above), and a Playwright E2E job.

### F38. ✅ Deployment
Options: Vercel · Netlify · Fly.io · Render · Docker image only. Preview deploys per PR?
**Answer:** Docker image only. No hosted deployment or preview deploys.

### F39. ✅ Containerize for local run
Dockerfile + docker-compose (fits the theme)?
**Answer:** Yes. Multi-stage Dockerfile running as a non-root user, plus `docker-compose.yml` so reviewers can run `docker compose up`.

### F40. ✅ Observability
Sentry (or none)? Structured logging (pino) on the proxy? Logging upstream rate-limit headers?
**Answer:** Console logging only. No Sentry, no pino.

### F41. ✅ Versioning & changelog
SemVer + Keep a Changelog. Write entries by hand, or use release-please / changesets?
**Answer:** SemVer + Keep a Changelog, entries written by hand in each PR.

---

## G. Security & resilience (see [RISKS.md](RISKS.md))

### G42. ✅ Proxy rate limiting
Per-IP limits (e.g. 60 req/min) and the library or edge rule to enforce them.
**Answer:** In-app per-IP limit of 60 req/min (`RATE_LIMIT_MAX` / `RATE_LIMIT_WINDOW_MS`) on `/api/*`, returning 429 with `Retry-After`. Caps on `page` and `page_size`.

### G43. ✅ Security headers & CSP
Allowed `img-src` hosts: `*.cloudfront.net` (logos), `www.gravatar.com` (avatars). HSTS, `frame-ancestors 'none'`, `Referrer-Policy`.
**Answer:** Strict CSP: `default-src 'self'`, nonce-based scripts, `img-src 'self'` plus the hosts above (extend as new logo hosts show up). Also HSTS, `frame-ancestors 'none'`, `Referrer-Policy: strict-origin-when-cross-origin`, `X-Content-Type-Options: nosniff`.

### G44. ✅ Upstream failure behavior
On 429 or 5xx: serve stale cache · show a degraded banner · retry with backoff · all of these?
**Answer:** All of these: one retry with backoff (honoring `Retry-After`), serve stale cache when available, and show a degraded banner when data is stale or upstream is failing. See [ADR-0003](adr/0003-server-cache-and-upstream-failures.md).

### G45. ✅ Optional Docker Hub token
Use a PAT (server env var only) to raise limits, or stay anonymous?
**Answer:** Anonymous only. No token code path; `DOCKERHUB_PAT` is removed from `.env.example`.
**Why:** Caching keeps us well under the anonymous limit, and no secrets means nothing to leak.
