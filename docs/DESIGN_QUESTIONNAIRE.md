# Design questionnaire

We go through these one at a time. For each question:
- fill in **Answer**,
- add a short **Why** if it isn't obvious,
- if a decision is significant, record it as an ADR in [adr/](adr/).

*Rec* is the starting suggestion, not a decision.

Status legend: ⬜ open · ✅ decided

---

## A. Architecture & stack

### A1. ⬜ Backend proxy form
A proxy is required because Docker Hub has no CORS headers ([ADR-0001](adr/0001-backend-proxy-for-cors.md)).
Options: Next.js route handlers · Node + Express · Node + Fastify · serverless function (Vercel/Netlify) · Vite dev proxy only (local-only; not deployable).
*Rec:* Next.js route handlers, or Vite + a small Fastify server.
**Answer:**

### A2. ⬜ Frontend framework
Options: React · Vue · Svelte · Angular.
*Rec:* React.
**Answer:**

### A3. ⬜ Meta-framework vs SPA
Options: Next.js (App Router, SSR) · Remix/React Router · Vite SPA.
Consider SSR/SEO for repo pages and whether the proxy lives in the same app.
**Answer:**

### A4. ⬜ TypeScript strict mode
*Rec:* yes, `strict: true`.
**Answer:**

### A5. ⬜ Repo layout
Options: single app · pnpm workspace (`apps/web`, `apps/api`, `packages/shared`).
*Rec:* single app, unless the proxy is a separate server.
**Answer:**

### A6. ⬜ Package manager & Node version
Options: pnpm · npm · yarn. Node LTS version pinned in `.nvmrc`.
*Rec:* pnpm, Node 22 LTS.
**Answer:**

---

## B. Data fetching & state

### B7. ⬜ Server-state library
Options: TanStack Query · SWR · RTK Query · plain fetch.
*Rec:* TanStack Query.
**Answer:**

### B8. ⬜ Client state (theme, recent searches, favorites)
Options: none (URL + localStorage) · React Context · Zustand.
**Answer:**

### B9. ⬜ Server-side caching
Options: in-memory LRU · Redis · HTTP `Cache-Control` + CDN · a combination.
TTLs to set: popular (≈10 min) · search (≈1 min) · repo (≈5 min) · tags (≈2 min) · publisher (≈1 h).
**Answer:**

### B10. ⬜ Runtime validation of upstream responses
Zod schemas protect against changes to the undocumented API.
*Rec:* yes.
**Answer:**

### B11. ⬜ Search interaction
Options: debounced as-you-type · submit-only · both. Autocomplete via `/api/search/v4/suggestions`?
**Answer:**

### B12. ⬜ Pagination style
Separately for search results and for tags. Options: numbered pages · "Load more" · infinite scroll.
**Answer:**

### B13. ⬜ URL as state
Put `q`, `sort`, `page`, and the tag filter in the query string, so links can be shared and Back/Forward works.
*Rec:* yes.
**Answer:**

---

## C. Routing & URLs

### C14. ⬜ URL scheme
Options: mirror Hub (`/r/{ns}/{repo}`, `/_/{repo}` for official images) · `/repo/{ns}/{repo}`.
**Answer:**

### C15. ⬜ Deep-linkable tag view
`/r/{ns}/{repo}/tags/{tag}` (uses the single-tag endpoint)?
**Answer:**

### C16. ⬜ 404 and error pages
Custom design? Separate states for "repo not found" and "Docker Hub unavailable"?
**Answer:**

---

## D. UI & visual design

### D17. ⬜ Component library
Options: shadcn/ui (Radix) + Tailwind · MUI · Chakra · Mantine · custom.
**Answer:**

### D18. ⬜ Styling approach
Options: Tailwind · CSS Modules · CSS-in-JS.
**Answer:**

### D19. ⬜ Dark mode
Options: system preference only · toggle · both (toggle that defaults to system).
**Answer:**

### D20. ⬜ Brand
Palette (Docker-like blue or our own)? Typeface? Logo or name for the app?
**Answer:**

### D21. ⬜ Explore layout
Options: card grid · list rows. Columns per breakpoint (e.g. 1 / 2 / 3 / 4)?
**Answer:**

### D22. ⬜ Card contents
Choose from: logo · name · owner · description · badge · pulls · stars · updated · arch chips.
**Answer:**

### D23. ⬜ Tags layout
Options: table with sortable columns · cards. Expandable row for the per-architecture breakdown?
**Answer:**

### D24. ⬜ Repository overview
Render `full_description` Markdown (sanitized)? Tabs "Overview | Tags" like Hub, or a single page?
**Answer:**

### D25. ⬜ Loading, empty and error states
Skeletons or spinners? Illustrations? Copy text for each state?
**Answer:**

### D26. ⬜ Formatting
- Dates: relative ("3 days ago") with absolute on hover?
- Sizes: MB (decimal) or MiB (binary)?
- Numbers: compact (1.2B)?

**Answer:**

### D27. ⬜ Copy-command feedback
Options: inline "Copied ✓" · toast. Fallback when the Clipboard API isn't available?
**Answer:**

---

## E. Product extras ("Product Thinking" in the brief)

### E28. ⬜ Which extras make the cut?
Tick the ones we're building:
- [ ] Tag name filter (upstream `name=`) and sort (`ordering=`)
- [ ] Copy pull-by-digest command
- [ ] Architecture / OS chips
- [ ] Official / verified publisher badges
- [ ] Recent searches (localStorage)
- [ ] Favorites (localStorage)
- [ ] `/` keyboard shortcut to focus search
- [ ] "View on Docker Hub" link
- [ ] Pulls and stars stats
- [ ] Tag deep links
- [ ] Sort search results (relevance / pulls / stars / updated)
- [ ] Badge filter on search
- [ ] Autocomplete suggestions
- [ ] Per-architecture size breakdown

**Answer / notes:**

### E29. ⬜ Responsive strategy
Mobile-first or desktop-first? Minimum supported width (e.g. 360 px)?
**Answer:**

### E30. ⬜ Accessibility target
WCAG 2.1 AA? Full keyboard navigation, focus rings, `aria-live` on copy feedback?
*Rec:* AA.
**Answer:**

### E31. ⬜ Internationalization
English only, or i18n-ready (message catalog, `Intl` formatting)?
**Answer:**

### E32. ⬜ Analytics
None · privacy-friendly (Plausible/Umami).
**Answer:**

---

## F. Quality & delivery

### F33. ⬜ Testing
- Unit: Vitest + Testing Library?
- API mocks: MSW?
- End-to-end: Playwright?
- Coverage target?

**Answer:**

### F34. ⬜ Lint & format
Options: ESLint + Prettier · Biome. Pre-commit hooks with Husky + lint-staged?
**Answer:**

### F35. ⬜ Commit convention
Conventional Commits enforced by commitlint?
*Rec:* yes (already in [CONTRIBUTING.md](../CONTRIBUTING.md)).
**Answer:**

### F36. ⬜ Branch strategy
Trunk-based with short-lived branches and PRs into `main`? Squash merges?
**Answer:**

### F37. ⬜ CI checks
GitHub Actions on every PR: lint · typecheck · test · build · `audit`?
**Answer:**

### F38. ⬜ Deployment
Options: Vercel · Netlify · Fly.io · Render · Docker image only. Preview deploys per PR?
**Answer:**

### F39. ⬜ Containerize for local run
Dockerfile + docker-compose (fits the theme)?
**Answer:**

### F40. ⬜ Observability
Sentry (or none)? Structured logging (pino) on the proxy? Logging upstream rate-limit headers?
**Answer:**

### F41. ⬜ Versioning & changelog
SemVer + Keep a Changelog. Write entries by hand, or use release-please / changesets?
**Answer:**

---

## G. Security & resilience (see [RISKS.md](RISKS.md))

### G42. ⬜ Proxy rate limiting
Per-IP limits (e.g. 60 req/min) and the library or edge rule to enforce them.
**Answer:**

### G43. ⬜ Security headers & CSP
Allowed `img-src` hosts: `*.cloudfront.net` (logos), `www.gravatar.com` (avatars). HSTS, `frame-ancestors 'none'`, `Referrer-Policy`.
**Answer:**

### G44. ⬜ Upstream failure behavior
On 429 or 5xx: serve stale cache · show a degraded banner · retry with backoff · all of these?
**Answer:**

### G45. ⬜ Optional Docker Hub token
Use a PAT (server env var only) to raise limits, or stay anonymous?
**Answer:**
