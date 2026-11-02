# AGENTS.md

Instructions for AI coding agents (Codex, Cursor, Copilot, Claude, etc.). The fuller version is [CLAUDE.md](CLAUDE.md); keep the two consistent.

## Context
- Docker Hub–like registry browser. Brief: [docs/ASSIGNMENT.md](docs/ASSIGNMENT.md).
- Phase: foundation. The stack is undecided; see [docs/DESIGN_QUESTIONNAIRE.md](docs/DESIGN_QUESTIONNAIRE.md).
- Docker Hub integration source of truth: [docs/API.md](docs/API.md).

## Setup / build / test
_TBD once the stack is chosen._

## Rules
- Never call `hub.docker.com` from the browser. Use the allowlisted `/api/*` proxy routes ([ADR-0001](docs/adr/0001-backend-proxy-for-cors.md)).
- Validate all route params and upstream responses. Cache upstream calls.
- Sanitize Markdown. No raw HTML from upstream.
- `library/` namespace is omitted from `docker pull` commands.
- No secrets in code or the client bundle.
- Follow [CONTRIBUTING.md](CONTRIBUTING.md): Conventional Commits, PRs only, update CHANGELOG and docs in the same change.
- Respect accepted ADRs in [docs/adr/](docs/adr/). Propose a new ADR to change one.
