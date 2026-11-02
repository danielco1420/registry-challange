Server-only code lives here in `*.server.ts` modules so it never reaches the client bundle.

- `config.server.ts`: typed env config, validated with Valibot when the server build loads. It's the only place that reads `process.env`; import `config` from it. `parseEnv(source)` is the pure parser behind it.
