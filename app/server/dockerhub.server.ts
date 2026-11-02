/**
 * Docker Hub upstream client. The only module that knows Docker Hub URLs
 * (docs/ARCHITECTURE.md, docs/API.md).
 *
 * Callers describe *what* they want with a typed `UpstreamRequest` built from
 * already-validated params (`app/lib/params.ts`); this module builds the URL.
 * It never accepts a URL or path from a caller (RISKS.md 2.2 / 2.3).
 *
 * Each call: per-attempt timeout (`UPSTREAM_TIMEOUT_MS`), descriptive
 * User-Agent, one retry on 429 / 5xx / timeout / network error / non-JSON
 * body, honoring `Retry-After` (ADR-0003). Failures surface as a typed
 * `UpstreamError`. The response is validated with the caller's Valibot schema.
 *
 * Every attempt, retries included, first takes a slot from the proxy-wide
 * upstream budget (`budget.server.ts`, ADR-0003). With no slot, nothing is
 * sent: a first attempt fails with `budget_exhausted`, a retry is skipped and
 * the previous failure is thrown.
 *
 * Not here: caching and the stale / 503 failure path, which live in
 * `upstream.server.ts` (`getCached`) around this client.
 */
import * as v from 'valibot';
import {
  BADGES,
  NAME_MAX_LENGTH,
  NAME_PATTERN,
  NO_CONTROL_CHARS,
  PAGE_MAX,
  PAGE_SIZE_MAX,
  QUERY_MAX_LENGTH,
  SEARCH_SORTS,
  SEARCH_SORT_UPSTREAM,
  TAG_MAX_LENGTH,
  TAG_ORDERINGS,
  TAG_PATTERN,
  type RepoParams,
  type SearchQuery,
  type TagParams,
  type TagsQuery,
} from '../lib/params';
import { upstreamBudget, type UpstreamBudget } from './budget.server';
import { config } from './config.server';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Identifies us to Docker Hub (and Cloudflare in front of it), RISKS.md 1.4. */
export const USER_AGENT = 'registry-ui (+https://github.com/danielco1420/registry-challange)';

/** First attempt plus one retry (ADR-0003). */
export const MAX_ATTEMPTS = 2;
/** Backoff before the retry when the response has no `Retry-After`: base plus random jitter. */
export const RETRY_BACKOFF_BASE_MS = 250;
export const RETRY_BACKOFF_JITTER_MS = 250;
/**
 * Longest `Retry-After` we wait in-request. A longer one (Docker Hub's 429
 * window is ~60 s) isn't retried: we fail fast with `retryAfterSeconds` so the
 * caller can serve stale data or pass the delay on to the client.
 */
export const MAX_RETRY_AFTER_MS = 3000;
/**
 * Upper bound for a parsed `Retry-After` / `x-ratelimit-reset` delay, so an
 * absurd header can't turn into `Infinity` in `retryAfterSeconds`.
 */
export const MAX_REPORTED_RETRY_AFTER_SECONDS = 86_400;

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export type UpstreamErrorKind =
  'not_found' | 'rate_limited' | 'unavailable' | 'bad_payload' | 'budget_exhausted';

export interface UpstreamErrorOptions {
  endpoint: UpstreamEndpoint;
  /** Upstream HTTP status, when a response was received. */
  status?: number;
  /** Upstream `Retry-After`, in whole seconds, when it sent one. */
  retryAfterSeconds?: number;
  /** For a schema mismatch: where the payload failed, e.g. `$.results[3].name` (see `formatIssuePath`). */
  issuePath?: string;
  cause?: unknown;
}

/**
 * A failed upstream call.
 * - `not_found`: 404 (Docker Hub sends `{"message":"object not found"}`).
 * - `rate_limited`: 429.
 * - `unavailable`: 5xx, timeout, network error, or any other non-2xx status (e.g. a Cloudflare 403).
 * - `bad_payload`: a 2xx that isn't JSON (e.g. a Cloudflare HTML page) or doesn't match the schema.
 * - `budget_exhausted`: the proxy-wide upstream budget had no slot, so nothing
 *   was sent. `retryAfterSeconds` is the time until a slot frees up.
 *
 * Messages never include the upstream body. For a schema mismatch, `issuePath`
 * names the first failing field (keys and indexes only, safe to log), and
 * `cause` is a `ValiError` whose issues may quote upstream values: log it
 * server-side, never send it to the client.
 */
export class UpstreamError extends Error {
  override name = 'UpstreamError';
  readonly kind: UpstreamErrorKind;
  readonly endpoint: UpstreamEndpoint;
  readonly status: number | undefined;
  readonly retryAfterSeconds: number | undefined;
  /** Set only when a 2xx JSON body failed the schema (`bad_payload`). */
  readonly issuePath: string | undefined;

  constructor(kind: UpstreamErrorKind, message: string, options: UpstreamErrorOptions) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.kind = kind;
    this.endpoint = options.endpoint;
    this.status = options.status;
    this.retryAfterSeconds = options.retryAfterSeconds;
    this.issuePath = options.issuePath;
  }
}

/** True for a `bad_payload` caused by JSON that didn't match the schema (not a non-JSON body). */
export function isSchemaMismatch(error: unknown): error is UpstreamError & { issuePath: string } {
  return (
    error instanceof UpstreamError &&
    error.kind === 'bad_payload' &&
    typeof error.issuePath === 'string'
  );
}

const IDENTIFIER = /^[A-Za-z_$][\w$]*$/;

/**
 * A Valibot issue path as a JSONPath-like string: `$` for the root, then
 * `.key`, `["odd key"]` or `[index]`. Only keys and indexes, never values, so
 * it's safe to log and to put in an error message.
 */
export function formatIssuePath(path: readonly { key: unknown }[] | undefined): string {
  let out = '$';
  for (const { key } of path ?? []) {
    if (typeof key === 'number') out += `[${key}]`;
    else if (typeof key === 'string' && IDENTIFIER.test(key)) out += `.${key}`;
    else out += `[${JSON.stringify(String(key))}]`;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Requests and URLs
// ---------------------------------------------------------------------------

/** Every upstream call we make (docs/API.md sections A to D). */
export type UpstreamRequest =
  /** A: `/api/search/v4`. Popular 10 is `{ q: '', page: 1, pageSize: 10, sort: 'pulls', badge: 'official' }`. */
  | { endpoint: 'search'; query: SearchQuery }
  /** A: `/api/search/v4/suggestions`. */
  | { endpoint: 'suggestions'; q: string }
  /**
   * A (fallback): legacy `/v2/search/repositories/`, used only when v4 fails its
   * schema (`search.server.ts`). Takes `q`, `page` and `pageSize`; it has no sort
   * or badge filter.
   */
  | { endpoint: 'legacySearch'; query: Pick<SearchQuery, 'q' | 'page' | 'pageSize'> }
  /** B: `/v2/namespaces/{ns}/repositories/{repo}`. */
  | { endpoint: 'repository'; params: RepoParams }
  /** C: `/v2/namespaces/{ns}/repositories/{repo}/tags`. */
  | { endpoint: 'tags'; params: RepoParams; query: TagsQuery }
  /** C: `/v2/namespaces/{ns}/repositories/{repo}/tags/{tag}`. */
  | { endpoint: 'tag'; params: TagParams }
  /** D: `/v2/orgs/{name}`. */
  | { endpoint: 'org'; name: string }
  /** D: `/v2/users/{name}`. */
  | { endpoint: 'user'; name: string };

export type UpstreamEndpoint = UpstreamRequest['endpoint'];

/**
 * Re-checks a path segment against our param grammar and encodes it. Routes
 * validate first; this is defense in depth so no caller can smuggle `/`, `..`
 * or `%2F` into a Docker Hub path. A failure is a programming error, not an
 * upstream failure, so it throws a `TypeError`.
 */
function segment(value: string, pattern: RegExp, maxLength: number, label: string): string {
  if (typeof value !== 'string' || value.length > maxLength || !pattern.test(value)) {
    throw new TypeError(`Invalid ${label} for an upstream request`);
  }
  return encodeURIComponent(value);
}

const name = (value: string, label: string) => segment(value, NAME_PATTERN, NAME_MAX_LENGTH, label);
const tag = (value: string) => segment(value, TAG_PATTERN, TAG_MAX_LENGTH, 'tag');

function int(value: number, min: number, max: number, label: string): number {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new TypeError(`Invalid ${label} for an upstream request`);
  }
  return value;
}

/** Free text for a query value: length-capped and free of control characters, like `QuerySchema`. */
function text(value: string, maxLength: number, label: string): string {
  if (typeof value !== 'string' || value.length > maxLength || !NO_CONTROL_CHARS.test(value)) {
    throw new TypeError(`Invalid ${label} for an upstream request`);
  }
  return value;
}

/** A value from one of our picklists (`sort`, `badge`, `ordering`). */
function oneOf<const T extends string>(value: T, allowed: readonly T[], label: string): T {
  if (!allowed.includes(value)) throw new TypeError(`Invalid ${label} for an upstream request`);
  return value;
}

function repoPath(params: RepoParams): string {
  return `/v2/namespaces/${name(params.ns, 'namespace')}/repositories/${name(params.repo, 'repo')}`;
}

/** Path and query for a request. Query values go through `URLSearchParams`, so they're encoded too. */
function pathAndQuery(request: UpstreamRequest): { path: string; query?: URLSearchParams } {
  switch (request.endpoint) {
    case 'search': {
      const { q, page, pageSize, sort, badge } = request.query;
      const size = int(pageSize, 1, PAGE_SIZE_MAX, 'pageSize');
      const from = (int(page, 1, PAGE_MAX, 'page') - 1) * size;
      const query = new URLSearchParams({
        query: text(q, QUERY_MAX_LENGTH, 'q'),
        from: String(from),
        size: String(size),
      });
      const upstreamSort = SEARCH_SORT_UPSTREAM[oneOf(sort, SEARCH_SORTS, 'sort')];
      if (upstreamSort) {
        query.set('sort', upstreamSort);
        query.set('order', 'desc');
      }
      if (badge !== undefined) query.set('badges', oneOf(badge, BADGES, 'badge'));
      return { path: '/api/search/v4', query };
    }
    case 'suggestions':
      return {
        path: '/api/search/v4/suggestions',
        query: new URLSearchParams({ query: text(request.q, QUERY_MAX_LENGTH, 'q') }),
      };
    case 'legacySearch': {
      const { q, page, pageSize } = request.query;
      return {
        // With the trailing slash, as documented in docs/API.md.
        path: '/v2/search/repositories/',
        query: new URLSearchParams({
          query: text(q, QUERY_MAX_LENGTH, 'q'),
          page: String(int(page, 1, PAGE_MAX, 'page')),
          page_size: String(int(pageSize, 1, PAGE_SIZE_MAX, 'pageSize')),
        }),
      };
    }
    case 'repository':
      return { path: repoPath(request.params) };
    case 'tags': {
      const { page, pageSize, ordering, name: filter } = request.query;
      const query = new URLSearchParams({
        page: String(int(page, 1, PAGE_MAX, 'page')),
        page_size: String(int(pageSize, 1, PAGE_SIZE_MAX, 'pageSize')),
      });
      if (ordering !== undefined) query.set('ordering', oneOf(ordering, TAG_ORDERINGS, 'ordering'));
      if (filter) query.set('name', text(filter, TAG_MAX_LENGTH, 'name'));
      return { path: `${repoPath(request.params)}/tags`, query };
    }
    case 'tag':
      return { path: `${repoPath(request.params)}/tags/${tag(request.params.tag)}` };
    case 'org':
      return { path: `/v2/orgs/${name(request.name, 'publisher')}` };
    case 'user':
      return { path: `/v2/users/${name(request.name, 'publisher')}` };
    default: {
      const unknown: never = request;
      throw new TypeError(
        `Unknown upstream endpoint: ${String((unknown as { endpoint: unknown }).endpoint)}`,
      );
    }
  }
}

/** Builds the Docker Hub URL for a request against `baseUrl` (an origin, see `config`). */
export function buildUpstreamUrl(baseUrl: string, request: UpstreamRequest): URL {
  const origin = new URL(baseUrl).origin;
  const { path, query } = pathAndQuery(request);
  const url = new URL(path, origin);
  if (query) url.search = query.toString();
  // Belt and braces: the URL must stay on the configured origin.
  if (url.origin !== origin) throw new TypeError('Upstream URL left the configured origin');
  return url;
}

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

/** RFC 9110 IMF-fixdate, e.g. `Mon, 02 Nov 2026 12:00:05 GMT`. `Date.parse` alone accepts `1.5` or `-1`. */
const IMF_FIXDATE =
  /^(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun), \d{2} (?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d{4} \d{2}:\d{2}:\d{2} GMT$/;

const MAX_REPORTED_DELAY_MS = MAX_REPORTED_RETRY_AFTER_SECONDS * 1000;

/** Clamps a delay to [0, MAX_REPORTED_RETRY_AFTER_SECONDS] in ms. */
const clampDelay = (ms: number) => Math.min(Math.max(0, ms), MAX_REPORTED_DELAY_MS);

/**
 * Parses a `Retry-After` header (delta seconds or IMF-fixdate) into milliseconds,
 * clamped to `MAX_REPORTED_RETRY_AFTER_SECONDS`. Returns `undefined` when absent
 * or unparseable.
 */
export function parseRetryAfter(
  value: string | null,
  now: number = Date.now(),
): number | undefined {
  if (value === null) return undefined;
  const trimmed = value.trim();
  if (/^\d+$/.test(trimmed)) return clampDelay(Number(trimmed) * 1000);
  if (!IMF_FIXDATE.test(trimmed)) return undefined;
  const date = Date.parse(trimmed);
  if (Number.isNaN(date)) return undefined;
  return clampDelay(date - now);
}

/**
 * Parses Docker Hub's `x-ratelimit-reset` (Unix time in seconds, docs/API.md)
 * into a delay in milliseconds. Used for a 429 without `Retry-After`, so we
 * don't retry inside a rate-limit window that hasn't reset.
 */
export function parseRateLimitReset(
  value: string | null,
  now: number = Date.now(),
): number | undefined {
  if (value === null) return undefined;
  const trimmed = value.trim();
  if (!/^\d{1,12}$/.test(trimmed)) return undefined;
  return clampDelay(Number(trimmed) * 1000 - now);
}

export interface DockerHubClientOptions {
  /** Docker Hub origin, e.g. `config.upstream.baseUrl`. */
  baseUrl: string;
  /** Per-attempt timeout, covering headers and body. */
  timeoutMs: number;
  /** Defaults to the global `fetch`. */
  fetch?: typeof globalThis.fetch;
  /** Waits before the retry. Defaults to `setTimeout`; tests inject a recorder. */
  sleep?: (ms: number) => Promise<void>;
  /** Jitter source in [0, 1). Defaults to `Math.random`. */
  random?: () => number;
  /**
   * Proxy-wide upstream budget; every attempt, retries included, takes a slot.
   * Required so no client can bypass it by accident: the app's client uses
   * `upstreamBudget`, and tests pass a stub.
   */
  budget: Pick<UpstreamBudget, 'tryAcquire' | 'retryAfterSeconds'>;
}

export interface DockerHubClient {
  /**
   * Calls Docker Hub and returns the response validated by `schema`.
   * Throws `UpstreamError` on any upstream failure.
   */
  get<const TSchema extends v.GenericSchema>(
    request: UpstreamRequest,
    schema: TSchema,
  ): Promise<v.InferOutput<TSchema>>;
}

type Attempt =
  | { ok: true; body: unknown }
  | { ok: false; error: UpstreamError; retry: boolean; retryAfterMs?: number };

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function isTimeout(error: unknown): boolean {
  return error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError');
}

/** Releases the connection when we don't read the body. */
async function discard(response: Response): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {
    // Nothing to do: the body is already closed or errored.
  }
}

export function createDockerHubClient(options: DockerHubClientOptions): DockerHubClient {
  const doFetch = options.fetch ?? ((input, init) => globalThis.fetch(input, init));
  const sleep = options.sleep ?? defaultSleep;
  const random = options.random ?? Math.random;

  async function attempt(url: URL, endpoint: UpstreamEndpoint): Promise<Attempt> {
    const fail = (
      kind: UpstreamErrorKind,
      message: string,
      retry: boolean,
      extra: { status?: number; retryAfterMs?: number; cause?: unknown } = {},
    ): Attempt => ({
      ok: false,
      retry,
      retryAfterMs: extra.retryAfterMs,
      error: new UpstreamError(kind, `Docker Hub ${endpoint}: ${message}`, {
        endpoint,
        status: extra.status,
        retryAfterSeconds:
          extra.retryAfterMs === undefined ? undefined : Math.ceil(extra.retryAfterMs / 1000),
        cause: extra.cause,
      }),
    });

    try {
      const response = await doFetch(url, {
        method: 'GET',
        headers: { Accept: 'application/json', 'User-Agent': USER_AGENT },
        // A redirect would leave the allowlisted URL; treat it as a failure instead of following it.
        redirect: 'manual',
        signal: AbortSignal.timeout(options.timeoutMs),
      });
      const { status } = response;

      if (status < 200 || status >= 300) {
        await discard(response);
        const retryAfterMs = parseRetryAfter(response.headers.get('retry-after'));
        if (status === 404) return fail('not_found', 'not found (404)', false, { status });
        if (status === 429) {
          // No Retry-After: fall back to the rate-limit window reset, so a ~60 s
          // window fails fast instead of being retried after a short backoff.
          const waitMs =
            retryAfterMs ?? parseRateLimitReset(response.headers.get('x-ratelimit-reset'));
          return fail('rate_limited', 'rate limited (429)', true, {
            status,
            retryAfterMs: waitMs,
          });
        }
        if (status >= 500) {
          return fail('unavailable', `server error (${status})`, true, { status, retryAfterMs });
        }
        return fail('unavailable', `unexpected status (${status})`, false, { status });
      }

      const contentType = response.headers.get('content-type');
      if (contentType !== null && !/json/i.test(contentType)) {
        await discard(response);
        return fail('bad_payload', 'response is not JSON', true, { status });
      }
      const raw = await response.text();
      try {
        return { ok: true, body: JSON.parse(raw) };
      } catch {
        // No `cause`: V8's SyntaxError message quotes the start of the body.
        return fail('bad_payload', 'response is not valid JSON', true, { status });
      }
    } catch (cause) {
      if (isTimeout(cause)) {
        return fail('unavailable', `timed out after ${options.timeoutMs} ms`, true, { cause });
      }
      return fail('unavailable', 'network error', true, { cause });
    }
  }

  return {
    async get(request, schema) {
      const url = buildUpstreamUrl(options.baseUrl, request);
      const { endpoint } = request;
      const { budget } = options;

      if (!budget.tryAcquire()) {
        throw new UpstreamError(
          'budget_exhausted',
          `Docker Hub ${endpoint}: upstream budget exhausted, request not sent`,
          { endpoint, retryAfterSeconds: budget.retryAfterSeconds() },
        );
      }
      let result = await attempt(url, endpoint);
      for (let n = 1; !result.ok && result.retry && n < MAX_ATTEMPTS; n++) {
        const delay =
          result.retryAfterMs ??
          RETRY_BACKOFF_BASE_MS + Math.floor(random() * RETRY_BACKOFF_JITTER_MS);
        // Honor Retry-After: wait it out, or give up now if it's too long to hold the request.
        if (delay > MAX_RETRY_AFTER_MS) break;
        await sleep(delay);
        // The retry counts against the budget too; with no slot left, keep the failure we have.
        if (!budget.tryAcquire()) break;
        result = await attempt(url, endpoint);
      }
      if (!result.ok) throw result.error;

      const parsed = v.safeParse(schema, result.body);
      if (!parsed.success) {
        const issuePath = formatIssuePath(parsed.issues[0].path);
        throw new UpstreamError(
          'bad_payload',
          `Docker Hub ${endpoint}: response doesn't match the expected schema at ${issuePath}`,
          { endpoint, issuePath, cause: new v.ValiError(parsed.issues) },
        );
      }
      return parsed.output;
    },
  };
}

/**
 * The app's client, configured from env (`DOCKERHUB_BASE_URL`, `UPSTREAM_TIMEOUT_MS`)
 * and bound to the proxy-wide budget (`UPSTREAM_BUDGET_PER_MIN`).
 */
export const dockerHub: DockerHubClient = createDockerHubClient({
  baseUrl: config.upstream.baseUrl,
  timeoutMs: config.upstream.timeoutMs,
  budget: upstreamBudget,
});
