# Changelog

All notable changes to this project are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Multi-stage `Dockerfile` (Node 22 Alpine): a build stage with full devDependencies compiling the app, and a minimal production runtime stage with prod-only dependencies, no `.env` or dev tooling baked in, running as the image's non-root `node` user over root-owned app files, exposing port 3000 and healthchecking `/api/health`. `.dockerignore` keeps `node_modules`, `.env*` (at any depth), `.git`, `.claude` and docs out of the build context. `docker-compose.yml` (Compose v2.24.0+) builds the image, maps port 3000, and optionally loads `.env` via `env_file` (missing file is fine). README documents both `docker build`/`docker run` and `docker compose up`.
- Docker Hub API map with live-verified endpoints, params, and response fields (`docs/API.md`).
- Design questionnaire covering stack, data, routing, UI, product, quality and security decisions.
- Risk register with mitigations (`docs/RISKS.md`).
- Architecture stub, project summary skeleton, and ADR-0001 (backend proxy, because Docker Hub has no CORS).
- Contribution rules, AI assistant guides (`CLAUDE.md`, `AGENTS.md`), GitHub templates, Dependabot, security policy, and editor/git config.

### Added
- Answers to every design questionnaire question; ADR-0002 (React Router v7 single app) and ADR-0003 (server cache and upstream failure handling).
- React Router v7 app (framework mode, SSR) with TypeScript strict, pnpm and Node 22; placeholder home page and `/api/health`.
- ESLint (typescript-eslint, React Hooks, jsx-a11y) and Prettier, with `pnpm lint`, `pnpm lint:fix`, `pnpm format` and `pnpm format:check`.
- Husky git hooks: pre-commit runs lint-staged, commit-msg runs commitlint (Conventional Commits, types from `CONTRIBUTING.md`).
- Valibot schemas for every route param (`namespace`, `repo`, `tag`, `q`, `page`, `pageSize`, `sort`, `badge`, `ordering`, tag filter) and a helper that turns a failed parse into a `400` JSON error (`app/lib/params.ts`, `app/lib/validate.ts`).
- Table-driven param cases (`app/lib/params.cases.ts`), run against the schemas by `pnpm test` (`app/lib/params.test.ts`).
- Typed env config (`app/server/config.server.ts`), validated with Valibot at startup. Invalid values, including `UPSTREAM_BUDGET_PER_MIN` above 150, stop the server with a clear message.
- Docker Hub upstream client (`app/server/dockerhub.server.ts`): builds URLs only from typed, validated requests; `UPSTREAM_TIMEOUT_MS` timeout; descriptive User-Agent; one retry on 429/5xx/timeout/non-JSON honoring `Retry-After` (or `x-ratelimit-reset` on a 429), failing fast instead when the wait is over 3 s; typed `UpstreamError` (`not_found`, `rate_limited`, `unavailable`, `bad_payload`); responses validated with a caller-supplied Valibot schema. Tests run in `pnpm test`.
- Server-side in-memory cache (`app/server/cache.server.ts`): LRU bounded by `CACHE_MAX_ENTRIES`, single-flight per key, stale-while-revalidate with one background refresh, ±10% TTL jitter, and a `HIT`/`MISS`/`STALE` status plus entry age for `X-Cache` headers. Not wired to routes yet.
- Per-client rate limiter (`app/server/rateLimit.server.ts`): `RATE_LIMIT_MAX` requests per `RATE_LIMIT_WINDOW_MS` per client IP, answering 429 with `Retry-After`, with bounded memory. Ready for `/api/*` routes and page loaders to call; not wired into them yet.
- `TRUST_PROXY_HOPS` env var (default `0`): how many reverse proxies' `X-Forwarded-For` entries to trust when resolving the client IP. With the default the client IP is unknown, so the per-client limit doesn't apply until a deployment sets it.
- Proxy-wide upstream budget (`app/server/budget.server.ts`): at most `UPSTREAM_BUDGET_PER_MIN` Docker Hub attempts in any 60 s, retries included; with no slot left, nothing is sent (`UpstreamError` kind `budget_exhausted`).
- `getCached(key, ttlSeconds, fetcher)` facade (`app/server/upstream.server.ts`) wiring the cache, the upstream client and the budget, with a `degraded` flag for the UI banner. When the budget is spent or Docker Hub is failing it serves stale data (`200`, `X-Cache: STALE`, `Cache-Control: no-store`) or, with nothing cached, a `503` JSON error with `Retry-After` and `Cache-Control: no-store`. Not wired to routes yet (T13).
- Pure formatting helpers in `app/lib`: `pullCommand`/`pullByDigest` (`app/lib/pull-command.ts`, strip the `library/` namespace per CLAUDE.md hard rule 6), and `formatRelativeDate`/`formatCompactNumber`/`formatSize` (`app/lib/format.ts`), all via `Intl` (`RelativeTimeFormat`, `NumberFormat`, `DateTimeFormat`); `formatSize` returns `"—"` for zero/unknown size (RISKS.md 4.3), and `formatRelativeDate` returns `"—"` for a missing or unparseable date.
- Test tooling: Vitest with a Node project (`app/**/*.test.ts`) and a jsdom project with Testing Library and jest-dom (`app/**/*.test.tsx`); MSW in both projects, which blocks any unhandled HTTP request or WebSocket to a non-loopback host so tests never reach Docker Hub; a `fixtures/dockerhub/` folder for recorded responses (filled in T08); Playwright (Chromium) with an e2e smoke test against the production build. Scripts: `pnpm test`, `pnpm test:watch`, `pnpm test:coverage` (v8 coverage of `app/server` and `app/lib`, report only, ~80% target) and `pnpm test:e2e`.
- CI (`.github/workflows/ci.yml`): GitHub Actions on every PR to `main` (and on pushes to `main`) with jobs `lint` (ESLint + Prettier check), `typecheck`, `test`, `build`, `audit` (`pnpm audit --audit-level=high`) and `e2e` (Playwright, Chromium). Node from `.nvmrc`, pnpm from `packageManager`, `pnpm install --frozen-lockfile`, pnpm store and Playwright browsers cached; the Playwright report and traces are uploaded after every e2e run that isn't cancelled. Dependabot now also updates the actions used by the local composite action in `.github/actions/`.
- `pnpm-workspace.yaml` with `allowBuilds: { esbuild: false }`, so `pnpm install` on a clean checkout no longer fails with `ERR_PNPM_IGNORED_BUILDS`. esbuild's install script stays off; esbuild still works through its platform package.
- Docker Hub response schemas (`app/server/dockerhub.schemas.server.ts`) for search v4, suggestions, legacy search, repository, tags, single tag, orgs and users, and normalizers (`app/server/normalize.server.ts`) into the `RepoSummary`, `RepoDetails`, `Tag` and `Page<T>` DTOs (`app/lib/dto.ts`): `library` handling, `pulls` + `pullsLabel` from either the `"1B+"` label or the number, missing logo/description/size fallbacks, attestation entries and non-repository search results dropped. `RepoSummary` gains `archived`.
- Search fallback (`app/server/search.server.ts`): when `/api/search/v4` fails its schema, one call to the legacy `/v2/search/repositories/` (new `legacySearch` client endpoint) answers instead, marked `source: "legacy"`. Not used for popular or badge-filtered searches; a sorted search falls back in relevance order.
- Recorded Docker Hub responses in `fixtures/dockerhub/` (popular, search, suggestions, legacy search, nginx, fluent/fluent-bit, a repo without a logo, an archived repo, publishers, a 404), MSW handlers that serve them (`test/msw/dockerhub.ts`), and contract tests for the schemas and normalizers.

### Fixed
- `searchParamsToObject` now keeps the first occurrence of a repeated query key even when it's empty, instead of falling through to a later value (e.g. `?sort=&sort=stars` now keeps `sort` missing).

### Changed
- A Docker Hub response that fails its schema now reports where: `UpstreamError` has `issuePath` (e.g. `$.results[3].name`, keys only, never values), also appended to the message.
- `docs/API.md`: documented what the live responses actually contain (v4 `name` and `publisher.name` semantics, `logo_url: {}`, pull-count labels, non-repository search results, archived repos answering 200, reversed tag `ordering`, attestation images, `/v2/users/{org}` redirecting to `/v2/orgs/{org}`), the normalization rules and the search fallback.
- Calling Docker Hub anonymously: removed `DOCKERHUB_PAT` from `.env.example`.
- PRs now merge with merge commits instead of squash.
- Moved the assignment brief from `README.md` to `docs/ASSIGNMENT.md`. `README.md` now describes the project.
- `docs/API.md`: param validation section now states that routes aren't wired to the schemas/helper yet, matching `docs/RISKS.md` 2.2/2.3.
- One test runner: the cache, upstream client, rate limiter and param tests moved from Node's built-in runner and the ad hoc `scripts/check-*.ts` checks to Vitest. The `scripts/` folder and its `.ts` resolve hook are gone.
