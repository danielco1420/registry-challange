# Changelog

All notable changes to this project are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
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
- `pnpm test`: runs the `app/lib/params.cases.ts` table against the schemas (dependency-free stand-in until Vitest lands; `scripts/check-params.ts`).
- Typed env config (`app/server/config.server.ts`), validated with Valibot at startup. Invalid values, including `UPSTREAM_BUDGET_PER_MIN` above 150, stop the server with a clear message.
- Docker Hub upstream client (`app/server/dockerhub.server.ts`): builds URLs only from typed, validated requests; `UPSTREAM_TIMEOUT_MS` timeout; descriptive User-Agent; one retry on 429/5xx/timeout/non-JSON honoring `Retry-After` (or `x-ratelimit-reset` on a 429), failing fast instead when the wait is over 3 s; typed `UpstreamError` (`not_found`, `rate_limited`, `unavailable`, `bad_payload`); responses validated with a caller-supplied Valibot schema. Tests run in `pnpm test` with Node's built-in test runner.

### Fixed
- `searchParamsToObject` now keeps the first occurrence of a repeated query key even when it's empty, instead of falling through to a later value (e.g. `?sort=&sort=stars` now keeps `sort` missing).

### Changed
- Calling Docker Hub anonymously: removed `DOCKERHUB_PAT` from `.env.example`.
- PRs now merge with merge commits instead of squash.
- Moved the assignment brief from `README.md` to `docs/ASSIGNMENT.md`. `README.md` now describes the project.
- `docs/API.md`: param validation section now states that routes aren't wired to the schemas/helper yet, matching `docs/RISKS.md` 2.2/2.3.
