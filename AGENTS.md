# AGENTS.md

Instructions for AI coding agents (Codex, Cursor, Copilot, Claude, etc.). The fuller version is [CLAUDE.md](CLAUDE.md); keep the two consistent.

## Context
- Docker Hub–like registry browser. Brief: [docs/ASSIGNMENT.md](docs/ASSIGNMENT.md).
- Phase: app scaffolded. Decisions: [docs/DESIGN_QUESTIONNAIRE.md](docs/DESIGN_QUESTIONNAIRE.md). Stack: React Router v7 single app, TypeScript strict, pnpm, Node 22, shadcn/ui + Tailwind, Valibot ([ADR-0002](docs/adr/0002-react-router-v7-single-app.md)).
- Docker Hub integration source of truth: [docs/API.md](docs/API.md).

## Setup / build / test
Node 22.12 or newer (`.nvmrc`) and pnpm 12.16.1 (the version pinned in `package.json`). Node 22's bundled Corepack is too old for pnpm 12, so install pnpm directly with `npm install -g pnpm@12.16.1`, or first run `npm install -g corepack@latest && corepack enable`.

```bash
pnpm install
cp .env.example .env   # optional; defaults apply
pnpm dev               # http://localhost:5173
pnpm typecheck         # react-router typegen && tsc
pnpm lint              # ESLint (pnpm lint:fix to autofix)
pnpm format:check      # Prettier (pnpm format to write)
pnpm test              # Vitest, once (pnpm test:watch to watch)
pnpm test:coverage     # Vitest + coverage of app/server and app/lib (coverage/index.html)
pnpm test:e2e          # Playwright (Chromium) against the production build on :4173
pnpm build && pnpm start   # production server, PORT defaults to 3000
```

`pnpm install` sets up Husky git hooks: pre-commit runs lint-staged (ESLint + Prettier on staged files), commit-msg runs commitlint (Conventional Commits).

CI (`.github/workflows/ci.yml`) runs on every PR to `main` with these jobs: `lint` (lint + format check), `typecheck`, `test`, `build`, `audit` (`pnpm audit --audit-level=high`) and `e2e`. Run the same commands locally before pushing. The job names are used as required checks, so don't rename them casually.

Dependency install scripts are off unless allowed in `allowBuilds` (`pnpm-workspace.yaml`); pnpm fails `pnpm install` on any dependency with an unreviewed build script. Allow or deny it there (`pnpm approve-builds`) and say why in the PR.

Tests (Vitest, questionnaire F33):
- `app/**/*.test.ts` run in Node (`node` project), `app/**/*.test.tsx` in jsdom with Testing Library and jest-dom (`dom` project). Import `describe`/`it`/`expect`/`vi` from `vitest` (no globals).
- MSW (`test/msw/server.ts`) runs for every test in both projects. Add handlers per test with `server.use(...)`; they reset after each test. Unhandled HTTP requests to non-loopback hosts get a 500 and unhandled WebSockets get an error, so tests never reach the real Docker Hub. Recorded responses go in `fixtures/dockerhub/` (T08).
- Coverage targets ~80% on `app/server` and `app/lib`; it is reported, not enforced.
- E2E specs live in `e2e/*.spec.ts`. Run `pnpm exec playwright install chromium` once before the first `pnpm test:e2e`.

Server-only code goes in `app/server/*.server.ts`. Read env vars only through `config` from `app/server/config.server.ts`, never `process.env` directly.

## Rules
- Never call `hub.docker.com` from the browser. Use the allowlisted `/api/*` proxy routes ([ADR-0001](docs/adr/0001-backend-proxy-for-cors.md)): `/api/popular`, `/api/search`, `/api/search/suggestions`, `/api/repos/:ns/:repo`, `/api/repos/:ns/:repo/tags` (and `/tags/:tag`), `/api/publishers/:name`. Any other `/api/*` path answers 404.
- Validate all route params and upstream responses. Cache upstream calls.
- Sanitize Markdown. No raw HTML from upstream.
- `library/` namespace is omitted from `docker pull` commands.
- No secrets in code or the client bundle.
- Follow [CONTRIBUTING.md](CONTRIBUTING.md): Conventional Commits, PRs only, update CHANGELOG and docs in the same change.
- Respect accepted ADRs in [docs/adr/](docs/adr/). Propose a new ADR to change one.
