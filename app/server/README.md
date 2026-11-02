Server-only code lives here in `*.server.ts` modules so it never reaches the client bundle.

- `config.server.ts`: typed env config, validated with Valibot when the server build loads. It's the only place that reads `process.env`; import `config` from it. `parseEnv(source)` is the pure parser behind it.
- `rateLimit.server.ts`: per-client rate limit (ADR-0003). Call `enforceRateLimit(request)` at the top of a resource route or page loader; it throws a 429 `Response` with `Retry-After` when the client is over `RATE_LIMIT_MAX` per `RATE_LIMIT_WINDOW_MS`. The module comment explains how the client IP is resolved (`TRUST_PROXY_HOPS`).
