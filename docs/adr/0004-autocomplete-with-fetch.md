# ADR-0004: Autocomplete with `fetch`, not `useFetcher`

- **Status:** Accepted
- **Date:** 2026-11-04

## Context

[ADR-0002](0002-react-router-v7-single-app.md) says loaders plus `useFetcher` cover page data, "Load more" and autocomplete. Building the search box (T22, questionnaire B11) showed a problem with `useFetcher` for autocomplete: when a fetcher's load fails, React Router sends the error to the nearest route ErrorBoundary (`setFetcherError`), which here is the root. A `429` from the per-client limit or a `503` from `/api/search/suggestions` while Docker Hub is failing would then swap the whole page for an error page, mid-typing. Suggestions are optional: the form submit has to keep working when they fail. We also want an explicit `AbortController` per request so a stale response can't win (RISKS 4.5).

## Decision

Autocomplete (`app/components/search/use-suggestions.ts`) calls our own proxy route `GET /api/search/suggestions?q=` with plain `fetch`, one `AbortController` per request, a 250 ms debounce and results keyed by query. Any failure (network, non-2xx, a body that fails its Valibot schema) becomes an `error` state shown in the dropdown; the search box keeps working.

Everything else in ADR-0002 stands: still no client server-state library, the browser still only calls our `/api/*` routes, and page data and "Load more" still use loaders and `useFetcher`.

## Alternatives considered

- **`useFetcher` with the proxy answering `200` on errors**: hides real status codes from every other client of `/api/search/suggestions` and makes caching headers misleading.
- **`useFetcher` with a route-level ErrorBoundary around the search box**: the header search box is rendered by the root layout, not by a route of its own, so its errors would still reach the root boundary.
- **TanStack Query or SWR**: a library for one hook; rejected in B7.

## Consequences

- One small hook does its own debounce, abort and response validation, with tests for the race and the error state.
- Autocomplete doesn't take part in React Router revalidation, which it doesn't need.
