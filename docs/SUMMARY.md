# Project summary

> The deliverable required by [ASSIGNMENT.md](ASSIGNMENT.md). Keep it short. Fill it in as decisions are made.

## APIs used and how we discovered them

See [API.md](API.md) for full details. In short:
- **Search**: `GET hub.docker.com/api/search/v4` (undocumented). Found in browser DevTools on hub.docker.com/search.
- **Repository**: `GET /v2/namespaces/{ns}/repositories/{repo}` (official API reference).
- **Tags**: `GET /v2/namespaces/{ns}/repositories/{repo}/tags` (official API reference).
- **Publisher avatar**: `GET /v2/orgs/{name}` / `/v2/users/{name}` (undocumented).
- Confirmed with curl: no CORS headers, ~180 req/min per IP, `page_size` capped at 100.

## Key design decisions

- Backend proxy, because Docker Hub has no CORS headers ([ADR-0001](adr/0001-backend-proxy-for-cors.md)).
- React Router v7 single app: SSR pages and the `/api/*` proxy in one Node process ([ADR-0002](adr/0002-react-router-v7-single-app.md)).
- In-memory LRU cache with single-flight and stale-while-revalidate; retry, stale fallback and a degraded banner on upstream failures ([ADR-0003](adr/0003-server-cache-and-upstream-failures.md)).
- Autocomplete with plain `fetch` and an `AbortController` rather than `useFetcher`, so a failed suggestion request can't replace the page ([ADR-0004](adr/0004-autocomplete-with-fetch.md)).
- Valibot validation of every upstream response, since `/api/search/v4` is undocumented.
- URLs mirror Docker Hub (`/r/{ns}/{repo}`, `/_/{repo}`), and search/sort/page state lives in the query string.

## Product decisions (added / left out, and why)

| Decision | Why |
|---|---|
| _TBD_ | |

## Challenges & lessons learned

- No CORS on Docker Hub, which forced a server component even for a "frontend" assignment.
- The search API is undocumented, so we added runtime validation and a fallback.
- _…_

## What we'd improve with more time

- _…_
