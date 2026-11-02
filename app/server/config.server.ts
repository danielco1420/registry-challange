import * as v from 'valibot';

/**
 * Typed server config, parsed from environment variables with Valibot.
 *
 * This is the only module that reads `process.env`. Everything else imports
 * `config` from here. Variables and defaults are documented in `.env.example`.
 */

/** Docker Hub's anonymous limit is ~180 req/min per IP; we stay below it (ADR-0003). */
export const MAX_UPSTREAM_BUDGET_PER_MIN = 150;

/** An env var holding a whole number in [min, max], with a default when unset. */
function intVar(defaultValue: number, min: number, max: number = Number.MAX_SAFE_INTEGER) {
  return v.optional(
    v.pipe(
      v.string(),
      v.trim(),
      v.regex(/^\d+$/, (issue) => `must be a whole number, got "${issue.input}"`),
      v.transform(Number),
      v.minValue(min, (issue) => `must be at least ${min}, got ${issue.input}`),
      v.maxValue(max, (issue) => `must be at most ${max}, got ${issue.input}`),
    ),
    String(defaultValue),
  );
}

/** Node timers (setTimeout, AbortSignal.timeout) treat larger delays as 1 ms. */
const MAX_TIMER_MS = 2_147_483_647;

/** True when `value` is a bare http(s) origin: no credentials, path, query or hash. */
function isHttpOrigin(value: string): boolean {
  if (!URL.canParse(value)) return false;
  const url = new URL(value);
  return (
    /^https?:$/.test(url.protocol) &&
    url.username === '' &&
    url.password === '' &&
    /^\/+$/.test(url.pathname) &&
    url.search === '' &&
    url.hash === '' &&
    !/[?#]/.test(value)
  );
}

/**
 * An env var holding an http(s) origin, normalized to `URL.origin` (no trailing slash).
 * The error doesn't echo the value, since a URL may embed credentials.
 */
const originVar = (defaultValue: string) =>
  v.optional(
    v.pipe(
      v.string(),
      v.trim(),
      v.check(
        isHttpOrigin,
        'must be an http(s) origin without credentials, path, query or hash (e.g. https://hub.docker.com)',
      ),
      v.transform((value) => new URL(value).origin),
    ),
    defaultValue,
  );

const EnvSchema = v.object({
  DOCKERHUB_BASE_URL: originVar('https://hub.docker.com'),
  UPSTREAM_TIMEOUT_MS: intVar(8000, 1, MAX_TIMER_MS),

  CACHE_TTL_POPULAR: intVar(600, 0),
  CACHE_TTL_SEARCH: intVar(60, 0),
  CACHE_TTL_REPO: intVar(300, 0),
  CACHE_TTL_TAGS: intVar(120, 0),
  CACHE_TTL_PUBLISHER: intVar(3600, 0),
  CACHE_MAX_ENTRIES: intVar(1000, 1),

  RATE_LIMIT_WINDOW_MS: intVar(60_000, 1, MAX_TIMER_MS),
  RATE_LIMIT_MAX: intVar(60, 1),

  UPSTREAM_BUDGET_PER_MIN: intVar(
    MAX_UPSTREAM_BUDGET_PER_MIN,
    1,
    MAX_UPSTREAM_BUDGET_PER_MIN,
  ),
});

export interface Config {
  upstream: {
    /** Docker Hub origin, without a trailing slash. */
    baseUrl: string;
    timeoutMs: number;
    /** Proxy-wide cap on upstream requests per minute, retries included. */
    budgetPerMin: number;
  };
  cache: {
    /** Fresh lifetime per endpoint, in seconds. */
    ttlSeconds: {
      popular: number;
      search: number;
      repo: number;
      tags: number;
      publisher: number;
    };
    maxEntries: number;
  };
  rateLimit: {
    windowMs: number;
    max: number;
  };
}

export class ConfigError extends Error {
  override name = 'ConfigError';
}

const BUDGET_HINT =
  `UPSTREAM_BUDGET_PER_MIN must not exceed ${MAX_UPSTREAM_BUDGET_PER_MIN}: ` +
  "Docker Hub's anonymous limit is ~180 req/min per IP, shared by all users (ADR-0003).";

/**
 * Parses and validates environment variables into a typed config.
 * Pure: reads only `source`. Unset or empty values fall back to defaults.
 * Throws a `ConfigError` listing every invalid variable.
 */
export function parseEnv(source: Record<string, string | undefined>): Config {
  const input: Record<string, string> = {};
  for (const key of Object.keys(EnvSchema.entries)) {
    const value = source[key];
    if (value !== undefined && value.trim() !== '') input[key] = value;
  }

  const result = v.safeParse(EnvSchema, input);
  if (!result.success) {
    const lines = result.issues.map((issue) => {
      const key = issue.path?.map((item) => String(item.key)).join('.') ?? '(root)';
      return `  - ${key} ${issue.message}`;
    });
    const overBudget = result.issues.some(
      (issue) => issue.path?.[0]?.key === 'UPSTREAM_BUDGET_PER_MIN' && issue.type === 'max_value',
    );
    if (overBudget) lines.push(`  ${BUDGET_HINT}`);
    throw new ConfigError(`Invalid environment configuration:\n${lines.join('\n')}`);
  }

  const env = result.output;
  return {
    upstream: {
      baseUrl: env.DOCKERHUB_BASE_URL,
      timeoutMs: env.UPSTREAM_TIMEOUT_MS,
      budgetPerMin: env.UPSTREAM_BUDGET_PER_MIN,
    },
    cache: {
      ttlSeconds: {
        popular: env.CACHE_TTL_POPULAR,
        search: env.CACHE_TTL_SEARCH,
        repo: env.CACHE_TTL_REPO,
        tags: env.CACHE_TTL_TAGS,
        publisher: env.CACHE_TTL_PUBLISHER,
      },
      maxEntries: env.CACHE_MAX_ENTRIES,
    },
    rateLimit: {
      windowMs: env.RATE_LIMIT_WINDOW_MS,
      max: env.RATE_LIMIT_MAX,
    },
  };
}

/** Validated once, when the server build loads (see `app/entry.server.tsx`). */
export const config: Config = parseEnv(process.env);
