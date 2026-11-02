# CLAUDE.md

Guidance for Claude Code (and other AI assistants) working in this repo. Tool-agnostic rules are also in [AGENTS.md](AGENTS.md); keep the two consistent.

## Project

Registry UI: a Docker Hub–like web app with two pages:
- **Explore**: search, plus the 10 most popular official images.
- **Repository details**: metadata, plus tags with a "copy `docker pull`" button.

The brief is in [docs/ASSIGNMENT.md](docs/ASSIGNMENT.md).

**Current phase:** app scaffolded; design decisions are in [docs/DESIGN_QUESTIONNAIRE.md](docs/DESIGN_QUESTIONNAIRE.md). Stack: React Router v7 (framework mode, SSR) single app, TypeScript strict, pnpm, Node 22, shadcn/ui + Tailwind, Valibot ([ADR-0002](docs/adr/0002-react-router-v7-single-app.md)). Don't add libraries the questionnaire doesn't name without asking.

## Read first

- [docs/API.md](docs/API.md): the endpoints we use, their params, and the fields we need. **Source of truth for Docker Hub integration.**
- [docs/RISKS.md](docs/RISKS.md): security and resilience constraints.
- [docs/adr/](docs/adr/): decisions already made. Don't contradict an accepted ADR without writing a new one.
- [CONTRIBUTING.md](CONTRIBUTING.md): branch, commit and PR rules.

## Commands

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

Tests (Vitest, questionnaire F33):
- `app/**/*.test.ts` run in Node (`node` project), `app/**/*.test.tsx` in jsdom with Testing Library and jest-dom (`dom` project). Import `describe`/`it`/`expect`/`vi` from `vitest` (no globals).
- MSW (`test/msw/server.ts`) runs for every test in both projects. Add handlers per test with `server.use(...)`; they reset after each test. Unhandled HTTP requests to non-loopback hosts get a 500 and unhandled WebSockets get an error, so tests never reach the real Docker Hub. Recorded responses go in `fixtures/dockerhub/` (T08).
- Coverage targets ~80% on `app/server` and `app/lib`; it is reported, not enforced.
- E2E specs live in `e2e/*.spec.ts`. Run `pnpm exec playwright install chromium` once before the first `pnpm test:e2e`.

Server-only code goes in `app/server/*.server.ts`. Read env vars only through `config` from `app/server/config.server.ts`, never `process.env` directly.

## Hard rules

1. Docker Hub has **no CORS**. The browser never calls `hub.docker.com`. All traffic goes through our proxy routes:
   - `/api/popular`
   - `/api/search`
   - `/api/repos/:ns/:repo`
   - `/api/repos/:ns/:repo/tags`
   - `/api/publishers/:name`
2. The proxy is an **allowlist**. Validate `namespace`/`repo`/`tag` params. Never forward arbitrary paths or URLs.
3. Cache upstream responses. The ~180 req/min per-IP limit is shared by all users.
4. Validate upstream JSON with Valibot schemas. `/api/search/v4` is undocumented and may change.
5. Sanitize `full_description` Markdown. Never render raw HTML from upstream.
6. Official images use namespace `library`. The pull command omits it (`docker pull nginx:tag`).
7. We call Docker Hub anonymously (no token). Any future secret stays server-side and comes from env vars only.

## Conventions

- Conventional Commits. Branch prefixes `feat/`, `fix/`, `docs/`, `chore/`, `refactor/`, `test/`.
- Update `CHANGELOG.md` `[Unreleased]` for user-visible changes.
- Update `docs/API.md` whenever an upstream call changes.
- Handle loading, empty and error states for every data view.
- Line endings are LF (enforced by `.gitattributes`). The dev machine is Windows.
