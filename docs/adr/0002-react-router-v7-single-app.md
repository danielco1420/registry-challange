# ADR-0002: React Router v7 framework mode as a single app

- **Status:** Accepted
- **Date:** 2026-11-02

## Context

[ADR-0001](0001-backend-proxy-for-cors.md) requires a server-side proxy for Docker Hub. We also want SSR so repository pages are shareable and render without a client-side waterfall. Questionnaire A1–A6, B7 and B10.

## Decision

Build one React Router v7 app in framework mode, with SSR, run on Node 22 LTS and managed with pnpm.

- The `/api/*` proxy routes are React Router resource routes in the same app.
- Page loaders call the same server-side upstream client and cache directly, rather than going through HTTP to `/api/*`; the same 60 req/min per-client-IP limit applies before each upstream request.
- Server-only code lives in `*.server.ts` modules so it can't reach the client bundle.
- No client server-state library: loaders plus `useFetcher` cover page data, "Load more" and autocomplete.
- Valibot schemas validate route params and upstream JSON.
- TypeScript `strict: true` plus `noUncheckedIndexedAccess`.

## Alternatives considered

- **Next.js (App Router)**: also fits, but its caching layers are harder to reason about and it pulls toward Vercel hosting.
- **Vite SPA + Fastify**: two processes and a workspace for a two-page app; no SSR.
- **TanStack Query on top of loaders**: duplicates loader caching for little gain.
- **Zod**: larger bundle than Valibot for the same validation.

## Consequences

- One process to build, run and containerize.
- The app needs a long-running Node server (no static hosting), which matches the Docker-only deployment (F38).
- The in-memory cache is per process; see [ADR-0003](0003-server-cache-and-upstream-failures.md).
