# AGENTS.md

Instructions for AI coding agents (Codex, Cursor, Copilot, Claude, etc.). The fuller version is [CLAUDE.md](CLAUDE.md); keep the two consistent.

## Context
- Docker Hub–like registry browser. Brief: [docs/ASSIGNMENT.md](docs/ASSIGNMENT.md).
- Phase: foundation done. Decisions: [docs/DESIGN_QUESTIONNAIRE.md](docs/DESIGN_QUESTIONNAIRE.md). Stack: React Router v7 single app, TypeScript strict, pnpm, Node 22, shadcn/ui + Tailwind, Valibot ([ADR-0002](docs/adr/0002-react-router-v7-single-app.md)).
- Docker Hub integration source of truth: [docs/API.md](docs/API.md).

## Setup / build / test
_Pending implementation: the stack is chosen (pnpm, Node 22) but the app is not scaffolded yet. Install, dev, lint, typecheck, test and build commands will be added here with the scaffold._

## Rules
- Never call `hub.docker.com` from the browser. Use the allowlisted `/api/*` proxy routes ([ADR-0001](docs/adr/0001-backend-proxy-for-cors.md)).
- Validate all route params and upstream responses. Cache upstream calls.
- Sanitize Markdown. No raw HTML from upstream.
- `library/` namespace is omitted from `docker pull` commands.
- No secrets in code or the client bundle.
- Follow [CONTRIBUTING.md](CONTRIBUTING.md): Conventional Commits, PRs only, update CHANGELOG and docs in the same change.
- Respect accepted ADRs in [docs/adr/](docs/adr/). Propose a new ADR to change one.
- Issues labelled `autopilot` are being worked by the Kanban autopilot routine ([.claude/skills/kanban-autopilot/SKILL.md](.claude/skills/kanban-autopilot/SKILL.md)). Don't pick them up.
