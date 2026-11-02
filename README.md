# Registry UI

A simplified Docker Hub–style web app for browsing and searching public container image repositories and their tags, built on Docker Hub's public APIs.

> The original assignment brief lives in [docs/ASSIGNMENT.md](docs/ASSIGNMENT.md).

## Status

🟡 **Foundation phase.** The API exploration, risk analysis and repo conventions are done. The tech stack and UI design are being decided in [docs/DESIGN_QUESTIONNAIRE.md](docs/DESIGN_QUESTIONNAIRE.md). No application code exists yet.

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

> Filled in once the stack is chosen (questionnaire section A).

```bash
# placeholder: e.g.
# pnpm install
# cp .env.example .env
# pnpm dev
```

Environment variables are documented in [.env.example](.env.example).

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

These files depend on the stack choice and will be added after the questionnaire:

- [ ] `package.json`, lockfile, `.nvmrc`
- [ ] Lint/format config (ESLint + Prettier)
- [ ] Git hooks (Husky + lint-staged + commitlint)
- [ ] CI workflow (`.github/workflows/ci.yml`): lint, typecheck, test, build, audit, E2E
- [ ] `Dockerfile` + `docker-compose.yml`
- [ ] Test setup (Vitest + Testing Library, MSW, Playwright)
- [ ] `.vscode/` recommended extensions and settings
- [ ] Set the Dependabot ecosystem in `.github/dependabot.yml`

## License

[MIT](LICENSE)
