# ADR-0001: Use a backend proxy to reach Docker Hub

- **Status:** Accepted
- **Date:** 2026-11-02

## Context

We sent requests with an `Origin` header to `hub.docker.com/v2/*` and `hub.docker.com/api/search/v4`. Docker Hub returns **no `Access-Control-Allow-Origin` header**, so browsers block direct calls from our UI.

Docker Hub also rate-limits anonymous API use to roughly 180 requests/min per IP.

## Decision

All Docker Hub traffic goes through our own thin backend (BFF). It exposes a small allowlist of routes (`/api/popular`, `/api/search`, `/api/repos/:ns/:repo`, `/api/repos/:ns/:repo/tags`, `/api/publishers/:name`). Those routes validate parameters, cache responses, rate-limit clients, and normalize upstream JSON into our DTOs.

The concrete runtime is React Router v7 resource routes ([ADR-0002](0002-react-router-v7-single-app.md)).

## Alternatives considered

- **Vite/webpack dev-server proxy only**: works locally but not when deployed.
- **Public CORS proxy** (e.g. corsproxy.io): an unreliable third party that also sees our traffic. Rejected.
- **Browser extension / disabling CORS**: not a real product.

## Consequences

- We need a server runtime for deployment, not just static hosting.
- Positive: one place for caching, rate limiting and validation.
- Positive: the frontend is decoupled from Docker Hub's response shapes.
- All users share the proxy's upstream rate limit, so caching is mandatory (see [RISKS.md](../RISKS.md) 1.1).
