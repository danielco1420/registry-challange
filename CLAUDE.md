# CLAUDE.md

Guidance for Claude Code (and other AI assistants) working in this repo. Tool-agnostic rules are also in [AGENTS.md](AGENTS.md); keep the two consistent.

## Project

Registry UI: a Docker Hub–like web app with two pages:
- **Explore**: search, plus the 10 most popular official images.
- **Repository details**: metadata, plus tags with a "copy `docker pull`" button.

The brief is in [docs/ASSIGNMENT.md](docs/ASSIGNMENT.md).

**Current phase:** foundation done; design decisions are in [docs/DESIGN_QUESTIONNAIRE.md](docs/DESIGN_QUESTIONNAIRE.md). Stack: React Router v7 (framework mode, SSR) single app, TypeScript strict, pnpm, Node 22, shadcn/ui + Tailwind, Valibot ([ADR-0002](docs/adr/0002-react-router-v7-single-app.md)). Don't add libraries the questionnaire doesn't name without asking.

## Read first

- [docs/API.md](docs/API.md): the endpoints we use, their params, and the fields we need. **Source of truth for Docker Hub integration.**
- [docs/RISKS.md](docs/RISKS.md): security and resilience constraints.
- [docs/adr/](docs/adr/): decisions already made. Don't contradict an accepted ADR without writing a new one.
- [CONTRIBUTING.md](CONTRIBUTING.md): branch, commit and PR rules.

## Commands

_Pending implementation: the stack is chosen (pnpm, Node 22) but the app is not scaffolded yet. Install, dev, lint, typecheck, test and build commands will be added here with the scaffold._

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
