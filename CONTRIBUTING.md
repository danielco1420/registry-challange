# Contributing

## Workflow

1. **Never push directly to `main`.** Every change goes through a pull request.
2. Branch from `main` with a prefix:
   - `feat/` new feature
   - `fix/` bug fix
   - `docs/` documentation
   - `chore/` tooling, deps, config
   - `refactor/` no behavior change
   - `test/` tests only

   Example: `feat/tag-filter`.
3. Keep PRs small and focused, with one logical change per PR.
4. Merge with a merge commit (no squash) once checks pass and the PR is reviewed.

## Commit messages: [Conventional Commits](https://www.conventionalcommits.org/)

```
<type>(<optional scope>): <imperative summary, ≤72 chars>

<optional body: what and why, not how>
```

Types: `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `build`, `ci`, `chore`, `revert`.
Breaking changes: `feat!: …` or a `BREAKING CHANGE:` footer.

Git hooks (installed by `pnpm install` through Husky; they also run in Git for Windows):
- `commit-msg` runs commitlint and rejects messages that don't follow this format.
- `pre-commit` runs ESLint and Prettier on staged files (lint-staged).

Examples:
- `feat(tags): add name filter to tag list`
- `fix(proxy): honor Retry-After on 429`
- `docs(api): document suggestions endpoint`

## Definition of done (PR checklist)

- [ ] Lint, typecheck, tests and build pass locally and in CI
- [ ] New logic has tests (unit for helpers/hooks, integration for proxy routes)
- [ ] `CHANGELOG.md` has an `[Unreleased]` entry for user-visible changes
- [ ] Docs updated if behavior, endpoints or env vars changed (`README.md`, `docs/API.md`, `.env.example`)
- [ ] A significant decision gets an ADR in `docs/adr/`
- [ ] UI changes include screenshots, and loading/empty/error states are handled
- [ ] Accessibility: keyboard reachable, labelled controls, sufficient contrast
- [ ] No secrets, tokens or `.env` files committed

## Code rules

- **Only the upstream client talks to Docker Hub.** Components and hooks call our `/api/*` routes, never `hub.docker.com`.
- **The proxy is an allowlist.** Never forward user-supplied URLs or paths. Validate every param.
- **Validate upstream responses** at runtime (schemas) and normalize them into our DTOs (see `docs/API.md`).
- **Never render raw HTML** from Docker Hub. Markdown must go through a sanitizer.
- Prefer small, pure, tested helpers (e.g. `pullCommand`, formatters) over logic inside components.
- No new dependency without a reason in the PR description.

## Docs to keep in sync

| When you… | Update |
|---|---|
| add or change a Docker Hub call | `docs/API.md` |
| make a stack or architecture decision | `docs/adr/`, `docs/ARCHITECTURE.md` |
| answer a design question | `docs/DESIGN_QUESTIONNAIRE.md` |
| add a mitigation or find a new risk | `docs/RISKS.md` |
| add an env var | `.env.example`, `README.md` |
| ship anything user-visible | `CHANGELOG.md` |
