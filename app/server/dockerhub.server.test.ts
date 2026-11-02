/**
 * Tests for the Docker Hub upstream client, run by `pnpm test` with Node's
 * built-in test runner. Vitest and MSW aren't set up yet (T03, #5), so a local
 * `node:http` server stands in for Docker Hub: the client uses real `fetch`
 * and a real timeout. Only the retry wait is injected, so tests don't sleep.
 */
import assert from 'node:assert/strict';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, beforeEach, describe, it } from 'node:test';
import * as v from 'valibot';
import {
  MAX_ATTEMPTS,
  MAX_REPORTED_RETRY_AFTER_SECONDS,
  RETRY_BACKOFF_BASE_MS,
  USER_AGENT,
  UpstreamError,
  buildUpstreamUrl,
  createDockerHubClient,
  parseRateLimitReset,
  parseRetryAfter,
  type DockerHubClientOptions,
  type UpstreamErrorKind,
  type UpstreamRequest,
} from './dockerhub.server';

// ---------------------------------------------------------------------------
// Fake Docker Hub
// ---------------------------------------------------------------------------

type Handler = (req: IncomingMessage, res: ServerResponse) => void;

let server: Server;
let baseUrl: string;
let handlers: Handler[];
let received: IncomingMessage[];

/** Queues one handler per expected upstream request, in order. */
function respond(...queue: Handler[]) {
  handlers = queue;
}

const json =
  (status: number, body: unknown, headers: Record<string, string> = {}): Handler =>
  (_req, res) => {
    res.writeHead(status, { 'Content-Type': 'application/json', ...headers });
    res.end(JSON.stringify(body));
  };

const raw =
  (status: number, contentType: string, body: string): Handler =>
  (_req, res) => {
    res.writeHead(status, { 'Content-Type': contentType });
    res.end(body);
  };

const slow =
  (delayMs: number): Handler =>
  (_req, res) => {
    setTimeout(() => {
      if (!res.destroyed) json(200, { late: true })(_req, res);
    }, delayMs);
  };

const CLOUDFLARE_HTML =
  '<!DOCTYPE html><html><head><title>Just a moment...</title></head><body>cf challenge</body></html>';

before(async () => {
  server = createServer((req, res) => {
    received.push(req);
    const handler = handlers.shift();
    if (handler) handler(req, res);
    else json(500, { message: 'no handler queued' })(req, res);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${port}`;
});

after(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

let sleeps: number[];

beforeEach(() => {
  handlers = [];
  received = [];
  sleeps = [];
});

function client(overrides: Partial<DockerHubClientOptions> = {}) {
  return createDockerHubClient({
    baseUrl,
    timeoutMs: 1000,
    sleep: async (ms) => {
      sleeps.push(ms);
    },
    random: () => 0.5,
    ...overrides,
  });
}

const RepoSchema = v.object({ namespace: v.string(), name: v.string(), pull_count: v.number() });
const repoRequest: UpstreamRequest = {
  endpoint: 'repository',
  params: { ns: 'library', repo: 'nginx' },
};
const NGINX = { namespace: 'library', name: 'nginx', pull_count: 13536895997 };

async function rejectsWith(
  promise: Promise<unknown>,
  kind: UpstreamErrorKind,
  extra: Partial<Pick<UpstreamError, 'status' | 'retryAfterSeconds'>> = {},
): Promise<UpstreamError> {
  try {
    await promise;
  } catch (error) {
    assert.ok(error instanceof UpstreamError, `expected UpstreamError, got ${String(error)}`);
    assert.equal(error.kind, kind);
    for (const [key, value] of Object.entries(extra)) {
      assert.equal(error[key as keyof typeof extra], value, key);
    }
    return error;
  }
  assert.fail(`expected an UpstreamError of kind ${kind}`);
}

// ---------------------------------------------------------------------------
// URL building
// ---------------------------------------------------------------------------

describe('buildUpstreamUrl', () => {
  const base = 'https://hub.docker.com';
  const href = (request: UpstreamRequest) => buildUpstreamUrl(base, request).href;

  it('maps search params to /api/search/v4', () => {
    assert.equal(
      href({
        endpoint: 'search',
        query: { q: 'nginx', page: 3, pageSize: 25, sort: 'stars', badge: 'verified_publisher' },
      }),
      'https://hub.docker.com/api/search/v4?query=nginx&from=50&size=25&sort=star_count&order=desc&badges=verified_publisher',
    );
  });

  it('builds the popular-10 query and omits sort for relevance', () => {
    assert.equal(
      href({
        endpoint: 'search',
        query: { q: '', page: 1, pageSize: 10, sort: 'pulls', badge: 'official' },
      }),
      'https://hub.docker.com/api/search/v4?query=&from=0&size=10&sort=pull_count&order=desc&badges=official',
    );
    assert.equal(
      href({ endpoint: 'search', query: { q: 'a b&c', page: 1, pageSize: 5, sort: 'relevance' } }),
      'https://hub.docker.com/api/search/v4?query=a+b%26c&from=0&size=5',
    );
  });

  it('encodes suggestions queries', () => {
    assert.equal(
      href({ endpoint: 'suggestions', q: 'ngï/../x' }),
      'https://hub.docker.com/api/search/v4/suggestions?query=ng%C3%AF%2F..%2Fx',
    );
  });

  it('builds repository, tags, tag and publisher paths', () => {
    assert.equal(
      href(repoRequest),
      'https://hub.docker.com/v2/namespaces/library/repositories/nginx',
    );
    assert.equal(
      href({
        endpoint: 'tags',
        params: { ns: 'fluent', repo: 'fluent-bit' },
        query: { page: 2, pageSize: 100, ordering: '-last_updated', name: 'alpine' },
      }),
      'https://hub.docker.com/v2/namespaces/fluent/repositories/fluent-bit/tags?page=2&page_size=100&ordering=-last_updated&name=alpine',
    );
    assert.equal(
      href({ endpoint: 'tag', params: { ns: 'library', repo: 'nginx', tag: '1.27.0-alpine' } }),
      'https://hub.docker.com/v2/namespaces/library/repositories/nginx/tags/1.27.0-alpine',
    );
    assert.equal(
      href({ endpoint: 'org', name: 'bitnami' }),
      'https://hub.docker.com/v2/orgs/bitnami',
    );
    assert.equal(
      href({ endpoint: 'user', name: 'edsiper' }),
      'https://hub.docker.com/v2/users/edsiper',
    );
  });

  it('rejects path segments that could change the path', () => {
    const bad: UpstreamRequest[] = [
      { endpoint: 'repository', params: { ns: '..', repo: 'nginx' } },
      { endpoint: 'repository', params: { ns: 'library', repo: 'a/b' } },
      { endpoint: 'repository', params: { ns: 'library', repo: '%2e%2e' } },
      { endpoint: 'repository', params: { ns: 'Library', repo: 'nginx' } },
      { endpoint: 'repository', params: { ns: 'library', repo: 'x'.repeat(256) } },
      { endpoint: 'tag', params: { ns: 'library', repo: 'nginx', tag: '../latest' } },
      { endpoint: 'tag', params: { ns: 'library', repo: 'nginx', tag: 'a?b' } },
      { endpoint: 'org', name: 'https://evil.example' },
      { endpoint: 'user', name: '' },
    ];
    for (const request of bad) {
      assert.throws(() => buildUpstreamUrl(base, request), TypeError, JSON.stringify(request));
    }
  });

  it('rejects out-of-range paging', () => {
    for (const query of [
      { page: 0, pageSize: 25 },
      { page: 1, pageSize: 1000 },
      { page: 1.5, pageSize: 25 },
    ]) {
      assert.throws(
        () => buildUpstreamUrl(base, { endpoint: 'tags', params: { ns: 'a', repo: 'b' }, query }),
        TypeError,
      );
    }
  });

  it('rejects picklist values and query text that bypassed validation', () => {
    const bad = [
      { endpoint: 'search', query: { q: 'x', page: 1, pageSize: 5, sort: 'constructor' } },
      { endpoint: 'search', query: { q: 'x', page: 1, pageSize: 5, sort: 'pulls', badge: 'x' } },
      { endpoint: 'search', query: { q: 'a\nb', page: 1, pageSize: 5, sort: 'pulls' } },
      { endpoint: 'suggestions', q: 'a\u0000b' },
      {
        endpoint: 'tags',
        params: { ns: 'a', repo: 'b' },
        query: { page: 1, pageSize: 5, ordering: 'evil' },
      },
    ] as unknown as UpstreamRequest[];
    for (const request of bad) {
      assert.throws(() => buildUpstreamUrl(base, request), TypeError, JSON.stringify(request));
    }
  });

  it('keeps only the origin of the base URL', () => {
    assert.equal(
      buildUpstreamUrl('https://hub.docker.com/', repoRequest).href,
      'https://hub.docker.com/v2/namespaces/library/repositories/nginx',
    );
  });
});

describe('parseRetryAfter', () => {
  it('parses delta seconds and HTTP dates', () => {
    assert.equal(parseRetryAfter(null), undefined);
    assert.equal(parseRetryAfter('2'), 2000);
    assert.equal(parseRetryAfter(' 0 '), 0);
    assert.equal(parseRetryAfter('soon'), undefined);
    const now = Date.parse('2026-11-02T12:00:00Z');
    assert.equal(parseRetryAfter('Mon, 02 Nov 2026 12:00:05 GMT', now), 5000);
    assert.equal(parseRetryAfter('Mon, 02 Nov 2026 11:59:00 GMT', now), 0);
  });

  it('rejects values Date.parse would misread', () => {
    for (const value of ['1.5', '-1', '1 2', 'Nov 2 2026', '2026-11-02T12:00:05Z']) {
      assert.equal(parseRetryAfter(value), undefined, value);
    }
  });

  it('clamps huge values instead of returning Infinity', () => {
    assert.equal(parseRetryAfter('9'.repeat(400)), MAX_REPORTED_RETRY_AFTER_SECONDS * 1000);
  });
});

describe('parseRateLimitReset', () => {
  it('turns a Unix reset time into a delay', () => {
    const now = Date.parse('2026-11-02T12:00:00Z');
    assert.equal(parseRateLimitReset(null, now), undefined);
    assert.equal(parseRateLimitReset(String(now / 1000 + 42), now), 42_000);
    assert.equal(parseRateLimitReset(String(now / 1000 - 5), now), 0);
    assert.equal(parseRateLimitReset('soon', now), undefined);
    assert.equal(parseRateLimitReset('9'.repeat(400), now), undefined);
  });
});

// ---------------------------------------------------------------------------
// Client behavior
// ---------------------------------------------------------------------------

describe('createDockerHubClient', () => {
  it('200: returns the validated body and sends our headers', async () => {
    respond(json(200, { ...NGINX, extra: 'ignored' }));
    const data = await client().get(repoRequest, RepoSchema);
    assert.deepEqual(data, NGINX);
    assert.equal(received.length, 1);
    assert.equal(received[0]?.method, 'GET');
    assert.equal(received[0]?.url, '/v2/namespaces/library/repositories/nginx');
    assert.equal(received[0]?.headers['user-agent'], USER_AGENT);
    assert.equal(received[0]?.headers.accept, 'application/json');
    assert.deepEqual(sleeps, []);
  });

  it('404 "object not found": not_found, no retry', async () => {
    respond(json(404, { message: 'object not found', errinfo: {} }));
    await rejectsWith(client().get(repoRequest, RepoSchema), 'not_found', { status: 404 });
    assert.equal(received.length, 1);
  });

  it('429 with Retry-After: waits that long, then retries', async () => {
    respond(json(429, { message: 'Too Many Requests' }, { 'Retry-After': '2' }), json(200, NGINX));
    assert.deepEqual(await client().get(repoRequest, RepoSchema), NGINX);
    assert.equal(received.length, 2);
    assert.deepEqual(sleeps, [2000]);
  });

  it('429 twice: rate_limited with retryAfterSeconds', async () => {
    respond(
      json(429, { message: 'Too Many Requests' }, { 'Retry-After': '1' }),
      json(429, { message: 'Too Many Requests' }, { 'Retry-After': '3' }),
    );
    await rejectsWith(client().get(repoRequest, RepoSchema), 'rate_limited', {
      status: 429,
      retryAfterSeconds: 3,
    });
    assert.equal(received.length, MAX_ATTEMPTS);
    assert.deepEqual(sleeps, [1000]);
  });

  it('429 with a long Retry-After: fails fast without retrying', async () => {
    respond(json(429, { message: 'Too Many Requests' }, { 'Retry-After': '60' }));
    await rejectsWith(client().get(repoRequest, RepoSchema), 'rate_limited', {
      status: 429,
      retryAfterSeconds: 60,
    });
    assert.equal(received.length, 1);
    assert.deepEqual(sleeps, []);
  });

  it('429 without Retry-After: uses x-ratelimit-reset and fails fast', async () => {
    const reset = Math.floor(Date.now() / 1000) + 60;
    respond(json(429, { message: 'Too Many Requests' }, { 'X-RateLimit-Reset': String(reset) }));
    const error = await rejectsWith(client().get(repoRequest, RepoSchema), 'rate_limited', {
      status: 429,
    });
    assert.ok(
      error.retryAfterSeconds !== undefined &&
        error.retryAfterSeconds >= 58 &&
        error.retryAfterSeconds <= 60,
      `retryAfterSeconds ${error.retryAfterSeconds}`,
    );
    assert.equal(received.length, 1);
    assert.deepEqual(sleeps, []);
  });

  it('429 with no rate-limit headers: one retry after the default backoff', async () => {
    respond(json(429, { message: 'Too Many Requests' }), json(200, NGINX));
    assert.deepEqual(await client().get(repoRequest, RepoSchema), NGINX);
    assert.equal(received.length, 2);
    assert.deepEqual(sleeps, [RETRY_BACKOFF_BASE_MS + 125]);
  });

  it('5xx then 200: retries once after a jittered backoff', async () => {
    respond(json(503, { message: 'unavailable' }), json(200, NGINX));
    assert.deepEqual(await client().get(repoRequest, RepoSchema), NGINX);
    assert.equal(received.length, 2);
    assert.equal(sleeps.length, 1);
    assert.ok(sleeps[0]! >= RETRY_BACKOFF_BASE_MS, `backoff ${sleeps[0]}`);
  });

  it('5xx twice: unavailable', async () => {
    respond(json(500, { message: 'boom' }), json(502, { message: 'bad gateway' }));
    await rejectsWith(client().get(repoRequest, RepoSchema), 'unavailable', { status: 502 });
    assert.equal(received.length, MAX_ATTEMPTS);
  });

  it('timeout: retries once, then unavailable', async () => {
    respond(slow(500), slow(500));
    const error = await rejectsWith(
      client({ timeoutMs: 50 }).get(repoRequest, RepoSchema),
      'unavailable',
      { status: undefined },
    );
    assert.match(error.message, /timed out/);
    assert.equal(received.length, MAX_ATTEMPTS);
  });

  it('timeout then 200: recovers on the retry', async () => {
    respond(slow(500), json(200, NGINX));
    assert.deepEqual(await client({ timeoutMs: 50 }).get(repoRequest, RepoSchema), NGINX);
    assert.equal(received.length, 2);
  });

  it('HTML body (Cloudflare) on 200: bad_payload after one retry', async () => {
    respond(
      raw(200, 'text/html; charset=UTF-8', CLOUDFLARE_HTML),
      raw(200, 'text/html; charset=UTF-8', CLOUDFLARE_HTML),
    );
    const error = await rejectsWith(client().get(repoRequest, RepoSchema), 'bad_payload', {
      status: 200,
    });
    assert.doesNotMatch(error.message, /<html|cf challenge/i);
    assert.equal(received.length, MAX_ATTEMPTS);
  });

  it('HTML body labelled as JSON: bad_payload', async () => {
    respond(
      raw(200, 'application/json', CLOUDFLARE_HTML),
      raw(200, 'application/json', CLOUDFLARE_HTML),
    );
    const error = await rejectsWith(client().get(repoRequest, RepoSchema), 'bad_payload');
    // Neither the message nor the cause may quote the upstream body.
    assert.doesNotMatch(`${error.message} ${String(error.cause)}`, /DOCTYPE|cf challenge/i);
  });

  it('HTML 403 challenge: unavailable, no retry', async () => {
    respond(raw(403, 'text/html', CLOUDFLARE_HTML));
    await rejectsWith(client().get(repoRequest, RepoSchema), 'unavailable', { status: 403 });
    assert.equal(received.length, 1);
  });

  it('JSON that fails the schema: bad_payload, no retry', async () => {
    respond(json(200, { namespace: 'library', name: 'nginx', pull_count: '1B+' }));
    const error = await rejectsWith(client().get(repoRequest, RepoSchema), 'bad_payload');
    assert.ok(error.cause instanceof v.ValiError);
    assert.equal(received.length, 1);
  });

  it('redirect: unavailable, not followed', async () => {
    respond((_req, res) => {
      res.writeHead(301, { Location: 'https://evil.example/' });
      res.end();
    });
    await rejectsWith(client().get(repoRequest, RepoSchema), 'unavailable', { status: 301 });
    assert.equal(received.length, 1);
  });

  it('network error: unavailable after one retry', async () => {
    let calls = 0;
    const failingFetch: typeof fetch = async () => {
      calls += 1;
      throw new TypeError('fetch failed');
    };
    await rejectsWith(client({ fetch: failingFetch }).get(repoRequest, RepoSchema), 'unavailable');
    assert.equal(calls, MAX_ATTEMPTS);
  });

  it('invalid params never reach the network', async () => {
    let calls = 0;
    const countingFetch: typeof fetch = async () => {
      calls += 1;
      return new Response('{}');
    };
    await assert.rejects(
      client({ fetch: countingFetch }).get(
        { endpoint: 'repository', params: { ns: 'library', repo: '../../v2/users/x' } },
        RepoSchema,
      ),
      TypeError,
    );
    assert.equal(calls, 0);
  });
});

// ---------------------------------------------------------------------------
// Upstream budget (ADR-0003)
// ---------------------------------------------------------------------------

describe('upstream budget', () => {
  /** A budget with `slots` left that records every acquisition attempt. */
  function fakeBudget(slots: number) {
    const state = { slots, acquired: 0, refused: 0 };
    return {
      state,
      budget: {
        tryAcquire() {
          if (state.slots <= 0) {
            state.refused += 1;
            return false;
          }
          state.slots -= 1;
          state.acquired += 1;
          return true;
        },
        retryAfterSeconds: () => 42,
      },
    };
  }

  it('counts every attempt, retries included', async () => {
    const { state, budget } = fakeBudget(10);
    respond(json(503, { message: 'unavailable' }), json(200, NGINX));
    assert.deepEqual(await client({ budget }).get(repoRequest, RepoSchema), NGINX);
    assert.equal(received.length, 2);
    assert.equal(state.acquired, 2);
  });

  it('takes one slot for a call that succeeds first time', async () => {
    const { state, budget } = fakeBudget(10);
    respond(json(200, NGINX));
    await client({ budget }).get(repoRequest, RepoSchema);
    assert.equal(state.acquired, 1);
  });

  it('sends nothing and throws budget_exhausted when there is no slot', async () => {
    const { state, budget } = fakeBudget(0);
    respond(json(200, NGINX));
    const error = await rejectsWith(
      client({ budget }).get(repoRequest, RepoSchema),
      'budget_exhausted',
      { retryAfterSeconds: 42, status: undefined },
    );
    assert.equal(error.endpoint, 'repository');
    assert.equal(received.length, 0);
    assert.equal(state.refused, 1);
  });

  it('skips the retry when the budget runs out and throws the first failure', async () => {
    const { state, budget } = fakeBudget(1);
    respond(json(503, { message: 'unavailable' }), json(200, NGINX));
    await rejectsWith(client({ budget }).get(repoRequest, RepoSchema), 'unavailable', {
      status: 503,
    });
    assert.equal(received.length, 1);
    assert.equal(state.acquired, 1);
    assert.equal(state.refused, 1);
  });

  it('takes no slot for a retry it would not make (long Retry-After)', async () => {
    const { state, budget } = fakeBudget(10);
    respond(json(429, { message: 'Too Many Requests' }, { 'Retry-After': '60' }));
    await rejectsWith(client({ budget }).get(repoRequest, RepoSchema), 'rate_limited');
    assert.equal(state.acquired, 1);
    assert.equal(state.refused, 0);
  });
});
