# Registry UI

A simplified Docker Hub–style web app for browsing and searching public container image repositories and their tags, built on Docker Hub's public APIs.

> The original assignment brief lives in [docs/ASSIGNMENT.md](docs/ASSIGNMENT.md).

## Status

🟡 **Scaffold phase.** Decisions are recorded in [docs/DESIGN_QUESTIONNAIRE.md](docs/DESIGN_QUESTIONNAIRE.md). The app skeleton runs; features are tracked as GitHub issues.

## Features (planned)

- **Explore**: search repositories by keyword and see a showcase of the 10 most popular official images (logo, name, description, owner).
- **Repository details**: title, description, owner, last updated, rendered overview.
- **Tags**: name, last updated, size, and a one-click **Copy** for `docker pull <repo>:<tag>`.
- Product extras: decided in the questionnaire (section E).

## Architecture at a glance

```
Browser (UI) ──► Our API proxy (BFF) ──► hub.docker.com
                 • allowlisted routes      • /api/search/v4          (search, undocumented)
                 • cache + coalescing      • /v2/namespaces/.../...  (repo, tags, documented)
                 • rate limiting           • /v2/orgs|users/{name}   (avatar fallback)
                 • response normalization
```

Docker Hub doesn't send CORS headers, so the browser can't call it directly. We need a proxy. See [ADR-0001](docs/adr/0001-backend-proxy-for-cors.md) and [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Getting started

Requires Node 22.12 or newer (`.nvmrc`) and pnpm 12.16.1 (the version pinned in `package.json`). Node 22's bundled Corepack is too old for pnpm 12, so install pnpm directly with `npm install -g pnpm@12.16.1`, or first run `npm install -g corepack@latest && corepack enable`.

```bash
pnpm install
cp .env.example .env   # optional; defaults apply
pnpm dev               # http://localhost:5173
pnpm typecheck
pnpm lint              # ESLint (pnpm lint:fix to autofix)
pnpm format:check      # Prettier (pnpm format to write)
pnpm test              # Vitest, once (pnpm test:watch to watch)
pnpm test:coverage     # Vitest + coverage of app/server and app/lib (coverage/index.html)
pnpm test:e2e          # Playwright (Chromium) against the production build on :4173
pnpm build && pnpm start
```

`pnpm install` also installs git hooks (Husky): staged files are linted and formatted on commit, and commit messages are checked against Conventional Commits.

Environment variables are documented in [.env.example](.env.example). All are optional; unset or empty values use the defaults shown there.

| Variable | Default | Allowed |
|---|---|---|
| `PUBLIC_ORIGIN` | unset | `http(s)` origin browsers use to reach the app. Set it behind a TLS-terminating reverse proxy, so `POST /theme`'s cross-origin check compares against it instead of the request URL. Covers the no-JavaScript form post only: React Router's own check on the toggle's JavaScript post still compares against the request URL |
| `DOCKERHUB_BASE_URL` | `https://hub.docker.com` | `http(s)` origin (no credentials, path, query or hash) |
| `UPSTREAM_TIMEOUT_MS` | `8000` | integer 1–2147483647 |
| `CACHE_TTL_POPULAR` / `_SEARCH` / `_REPO` / `_TAGS` / `_PUBLISHER` (seconds) | `600` / `60` / `300` / `120` / `3600` | integer ≥ 0 |
| `CACHE_MAX_ENTRIES` | `1000` | integer ≥ 1 |
| `RATE_LIMIT_WINDOW_MS` | `60000` | integer 1–2147483647 |
| `RATE_LIMIT_MAX` | `60` | integer ≥ 1 |
| `TRUST_PROXY_HOPS` | `0` | integer 0–10: reverse proxies in front of the app whose `X-Forwarded-For` is trusted for the per-client rate limit. With `0` the client IP is unknown, so the per-client limit is off |
| `UPSTREAM_BUDGET_PER_MIN` | `150` | integer 1–150 |

They're validated when the server starts (`app/server/config.server.ts`). An invalid value, including `UPSTREAM_BUDGET_PER_MIN` above 150, stops `pnpm start` with a message naming the variable. In `pnpm dev` the error appears on the first request.

## Docker

Build and run the production image directly:

```bash
docker build -t registry-challange .
docker run --rm -p 3000:3000 registry-challange
```

With a `.env` file, pass it explicitly to load it into the container:

```bash
docker run --rm -p 3000:3000 --env-file .env registry-challange
```

Or with Compose (v2.24.0 or newer), which reads `.env` automatically if present:

```bash
docker compose up --build
```

Either way the app is served on <http://localhost:3000>, with a container healthcheck polling `/api/health`. The final image runs as a non-root user, contains only production dependencies, and never bakes in a `.env` file — environment variables are supplied at `docker run`/`docker compose up` time. Compose pins `PORT=3000` inside the container to match its port mapping; with `docker run`, keep `PORT` unset (or change `-p` to match). Behind a reverse proxy, set `TRUST_PROXY_HOPS` so the per-client rate limit can see client IPs, and `PUBLIC_ORIGIN` if the proxy terminates TLS.

## Documentation

| Doc | What's in it |
|---|---|
| [docs/API.md](docs/API.md) | Docker Hub endpoints, params, responses, and the fields we use |
| [docs/DESIGN_QUESTIONNAIRE.md](docs/DESIGN_QUESTIONNAIRE.md) | Every design decision, with options and answers |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | System design, data flow, caching |
| [docs/RISKS.md](docs/RISKS.md) | Known risks and mitigations |
| [docs/adr/](docs/adr/) | Architecture Decision Records |
| [docs/SUMMARY.md](docs/SUMMARY.md) | Assignment deliverable: decisions, lessons, future work |
| [CONTRIBUTING.md](CONTRIBUTING.md) | Branching, commits, PR rules |
| [CHANGELOG.md](CHANGELOG.md) | Release history |
| [CLAUDE.md](CLAUDE.md) / [AGENTS.md](AGENTS.md) | Guidance for AI coding assistants |
| [SECURITY.md](SECURITY.md) | Reporting vulnerabilities |

## Roadmap

The stack is chosen. Remaining setup is tracked as GitHub issues; the unchecked items below are still to do:

- [x] `package.json`, lockfile, `.nvmrc`
- [x] Lint/format config (ESLint + Prettier)
- [x] Git hooks (Husky + lint-staged + commitlint)
- [x] CI workflow (`.github/workflows/ci.yml`): lint, typecheck, test, build, audit, E2E
- [x] `Dockerfile` + `docker-compose.yml`
- [x] Test setup (Vitest + Testing Library, MSW, Playwright)
- [ ] `.vscode/` recommended extensions and settings
- [ ] Set the Dependabot ecosystem in `.github/dependabot.yml`

## License

[MIT](LICENSE)
