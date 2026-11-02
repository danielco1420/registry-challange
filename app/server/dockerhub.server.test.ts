/**
 * Tests for the Docker Hub upstream client. Most run against a local `node:http`
 * server standing in for Docker Hub, so the client uses real `fetch`, a real
 * timeout and real redirect handling (MSW lets loopback requests through). Only
 * the retry wait is injected, so tests don't sleep. The last block uses MSW.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { http, HttpResponse } from 'msw';
import * as v from 'valibot';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { server as msw } from '../../test/msw/server';
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

beforeAll(async () => {
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

afterAll(async () => {
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
    expect(error).toBeInstanceOf(UpstreamError);
    const upstreamError = error as UpstreamError;
    expect(upstreamError.kind).toBe(kind);
    for (const [key, value] of Object.entries(extra)) {
      expect(upstreamError[key as keyof typeof extra], key).toBe(value);
    }
    return upstreamError;
  }
  return expect.fail(`expected an UpstreamError of kind ${kind}`);
}

// ---------------------------------------------------------------------------
// URL building
// ---------------------------------------------------------------------------

describe('buildUpstreamUrl', () => {
  const base = 'https://hub.docker.com';
  const href = (request: UpstreamRequest) => buildUpstreamUrl(base, request).href;

  it('maps search params to /api/search/v4', () => {
    expect(
      href({
        endpoint: 'search',
        query: { q: 'nginx', page: 3, pageSize: 25, sort: 'stars', badge: 'verified_publisher' },
      }),
    ).toBe(
      'https://hub.docker.com/api/search/v4?query=nginx&from=50&size=25&sort=star_count&order=desc&badges=verified_publisher',
    );
  });

  it('builds the popular-10 query and omits sort for relevance', () => {
    expect(
      href({
        endpoint: 'search',
        query: { q: '', page: 1, pageSize: 10, sort: 'pulls', badge: 'official' },
      }),
    ).toBe(
      'https://hub.docker.com/api/search/v4?query=&from=0&size=10&sort=pull_count&order=desc&badges=official',
    );
    expect(
      href({ endpoint: 'search', query: { q: 'a b&c', page: 1, pageSize: 5, sort: 'relevance' } }),
    ).toBe('https://hub.docker.com/api/search/v4?query=a+b%26c&from=0&size=5');
  });

  it('encodes suggestions queries', () => {
    expect(href({ endpoint: 'suggestions', q: 'ngï/../x' })).toBe(
      'https://hub.docker.com/api/search/v4/suggestions?query=ng%C3%AF%2F..%2Fx',
    );
  });

  it('builds repository, tags, tag and publisher paths', () => {
    expect(href(repoRequest)).toBe(
      'https://hub.docker.com/v2/namespaces/library/repositories/nginx',
    );
    expect(
      href({
        endpoint: 'tags',
        params: { ns: 'fluent', repo: 'fluent-bit' },
        query: { page: 2, pageSize: 100, ordering: '-last_updated', name: 'alpine' },
      }),
    ).toBe(
      'https://hub.docker.com/v2/namespaces/fluent/repositories/fluent-bit/tags?page=2&page_size=100&ordering=-last_updated&name=alpine',
    );
    expect(
      href({ endpoint: 'tag', params: { ns: 'library', repo: 'nginx', tag: '1.27.0-alpine' } }),
    ).toBe('https://hub.docker.com/v2/namespaces/library/repositories/nginx/tags/1.27.0-alpine');
    expect(href({ endpoint: 'org', name: 'bitnami' })).toBe(
      'https://hub.docker.com/v2/orgs/bitnami',
    );
    expect(href({ endpoint: 'user', name: 'edsiper' })).toBe(
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
      expect(() => buildUpstreamUrl(base, request), JSON.stringify(request)).toThrow(TypeError);
    }
  });

  it('rejects out-of-range paging', () => {
    for (const query of [
      { page: 0, pageSize: 25 },
      { page: 1, pageSize: 1000 },
      { page: 1.5, pageSize: 25 },
    ]) {
      expect(() =>
        buildUpstreamUrl(base, { endpoint: 'tags', params: { ns: 'a', repo: 'b' }, query }),
      ).toThrow(TypeError);
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
      expect(() => buildUpstreamUrl(base, request), JSON.stringify(request)).toThrow(TypeError);
    }
  });

  it('keeps only the origin of the base URL', () => {
    expect(buildUpstreamUrl('https://hub.docker.com/', repoRequest).href).toBe(
      'https://hub.docker.com/v2/namespaces/library/repositories/nginx',
    );
  });
});

describe('parseRetryAfter', () => {
  it('parses delta seconds and HTTP dates', () => {
    expect(parseRetryAfter(null)).toBeUndefined();
    expect(parseRetryAfter('2')).toBe(2000);
    expect(parseRetryAfter(' 0 ')).toBe(0);
    expect(parseRetryAfter('soon')).toBeUndefined();
    const now = Date.parse('2026-11-02T12:00:00Z');
    expect(parseRetryAfter('Mon, 02 Nov 2026 12:00:05 GMT', now)).toBe(5000);
    expect(parseRetryAfter('Mon, 02 Nov 2026 11:59:00 GMT', now)).toBe(0);
  });

  it('rejects values Date.parse would misread', () => {
    for (const value of ['1.5', '-1', '1 2', 'Nov 2 2026', '2026-11-02T12:00:05Z']) {
      expect(parseRetryAfter(value), value).toBeUndefined();
    }
  });

  it('clamps huge values instead of returning Infinity', () => {
    expect(parseRetryAfter('9'.repeat(400))).toBe(MAX_REPORTED_RETRY_AFTER_SECONDS * 1000);
  });
});

describe('parseRateLimitReset', () => {
  it('turns a Unix reset time into a delay', () => {
    const now = Date.parse('2026-11-02T12:00:00Z');
    expect(parseRateLimitReset(null, now)).toBeUndefined();
    expect(parseRateLimitReset(String(now / 1000 + 42), now)).toBe(42_000);
    expect(parseRateLimitReset(String(now / 1000 - 5), now)).toBe(0);
    expect(parseRateLimitReset('soon', now)).toBeUndefined();
    expect(parseRateLimitReset('9'.repeat(400), now)).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Client behavior
// ---------------------------------------------------------------------------

describe('createDockerHubClient', () => {
  it('200: returns the validated body and sends our headers', async () => {
    respond(json(200, { ...NGINX, extra: 'ignored' }));
    const data = await client().get(repoRequest, RepoSchema);
    expect(data).toEqual(NGINX);
    expect(received.length).toBe(1);
    expect(received[0]?.method).toBe('GET');
    expect(received[0]?.url).toBe('/v2/namespaces/library/repositories/nginx');
    expect(received[0]?.headers['user-agent']).toBe(USER_AGENT);
    expect(received[0]?.headers.accept).toBe('application/json');
    expect(sleeps).toEqual([]);
  });

  it('404 "object not found": not_found, no retry', async () => {
    respond(json(404, { message: 'object not found', errinfo: {} }));
    await rejectsWith(client().get(repoRequest, RepoSchema), 'not_found', { status: 404 });
    expect(received.length).toBe(1);
  });

  it('429 with Retry-After: waits that long, then retries', async () => {
    respond(json(429, { message: 'Too Many Requests' }, { 'Retry-After': '2' }), json(200, NGINX));
    expect(await client().get(repoRequest, RepoSchema)).toEqual(NGINX);
    expect(received.length).toBe(2);
    expect(sleeps).toEqual([2000]);
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
    expect(received.length).toBe(MAX_ATTEMPTS);
    expect(sleeps).toEqual([1000]);
  });

  it('429 with a long Retry-After: fails fast without retrying', async () => {
    respond(json(429, { message: 'Too Many Requests' }, { 'Retry-After': '60' }));
    await rejectsWith(client().get(repoRequest, RepoSchema), 'rate_limited', {
      status: 429,
      retryAfterSeconds: 60,
    });
    expect(received.length).toBe(1);
    expect(sleeps).toEqual([]);
  });

  it('429 without Retry-After: uses x-ratelimit-reset and fails fast', async () => {
    const reset = Math.floor(Date.now() / 1000) + 60;
    respond(json(429, { message: 'Too Many Requests' }, { 'X-RateLimit-Reset': String(reset) }));
    const error = await rejectsWith(client().get(repoRequest, RepoSchema), 'rate_limited', {
      status: 429,
    });
    expect(error.retryAfterSeconds).toBeGreaterThanOrEqual(58);
    expect(error.retryAfterSeconds).toBeLessThanOrEqual(60);
    expect(received.length).toBe(1);
    expect(sleeps).toEqual([]);
  });

  it('429 with no rate-limit headers: one retry after the default backoff', async () => {
    respond(json(429, { message: 'Too Many Requests' }), json(200, NGINX));
    expect(await client().get(repoRequest, RepoSchema)).toEqual(NGINX);
    expect(received.length).toBe(2);
    expect(sleeps).toEqual([RETRY_BACKOFF_BASE_MS + 125]);
  });

  it('5xx then 200: retries once after a jittered backoff', async () => {
    respond(json(503, { message: 'unavailable' }), json(200, NGINX));
    expect(await client().get(repoRequest, RepoSchema)).toEqual(NGINX);
    expect(received.length).toBe(2);
    expect(sleeps.length).toBe(1);
    expect(sleeps[0]).toBeGreaterThanOrEqual(RETRY_BACKOFF_BASE_MS);
  });

  it('5xx twice: unavailable', async () => {
    respond(json(500, { message: 'boom' }), json(502, { message: 'bad gateway' }));
    await rejectsWith(client().get(repoRequest, RepoSchema), 'unavailable', { status: 502 });
    expect(received.length).toBe(MAX_ATTEMPTS);
  });

  it('timeout: retries once, then unavailable', async () => {
    respond(slow(500), slow(500));
    const error = await rejectsWith(
      client({ timeoutMs: 50 }).get(repoRequest, RepoSchema),
      'unavailable',
      { status: undefined },
    );
    expect(error.message).toMatch(/timed out/);
    expect(received.length).toBe(MAX_ATTEMPTS);
  });

  it('timeout then 200: recovers on the retry', async () => {
    respond(slow(500), json(200, NGINX));
    expect(await client({ timeoutMs: 50 }).get(repoRequest, RepoSchema)).toEqual(NGINX);
    expect(received.length).toBe(2);
  });

  it('HTML body (Cloudflare) on 200: bad_payload after one retry', async () => {
    respond(
      raw(200, 'text/html; charset=UTF-8', CLOUDFLARE_HTML),
      raw(200, 'text/html; charset=UTF-8', CLOUDFLARE_HTML),
    );
    const error = await rejectsWith(client().get(repoRequest, RepoSchema), 'bad_payload', {
      status: 200,
    });
    expect(error.message).not.toMatch(/<html|cf challenge/i);
    expect(received.length).toBe(MAX_ATTEMPTS);
  });

  it('HTML body labelled as JSON: bad_payload', async () => {
    respond(
      raw(200, 'application/json', CLOUDFLARE_HTML),
      raw(200, 'application/json', CLOUDFLARE_HTML),
    );
    const error = await rejectsWith(client().get(repoRequest, RepoSchema), 'bad_payload');
    // Neither the message nor the cause may quote the upstream body.
    expect(`${error.message} ${String(error.cause)}`).not.toMatch(/DOCTYPE|cf challenge/i);
  });

  it('HTML 403 challenge: unavailable, no retry', async () => {
    respond(raw(403, 'text/html', CLOUDFLARE_HTML));
    await rejectsWith(client().get(repoRequest, RepoSchema), 'unavailable', { status: 403 });
    expect(received.length).toBe(1);
  });

  it('JSON that fails the schema: bad_payload, no retry', async () => {
    respond(json(200, { namespace: 'library', name: 'nginx', pull_count: '1B+' }));
    const error = await rejectsWith(client().get(repoRequest, RepoSchema), 'bad_payload');
    expect(error.cause).toBeInstanceOf(v.ValiError);
    expect(received.length).toBe(1);
  });

  it('redirect: unavailable, not followed', async () => {
    respond((_req, res) => {
      res.writeHead(301, { Location: 'https://evil.example/' });
      res.end();
    });
    await rejectsWith(client().get(repoRequest, RepoSchema), 'unavailable', { status: 301 });
    expect(received.length).toBe(1);
  });

  it('network error: unavailable after one retry', async () => {
    let calls = 0;
    const failingFetch: typeof fetch = async () => {
      calls += 1;
      throw new TypeError('fetch failed');
    };
    await rejectsWith(client({ fetch: failingFetch }).get(repoRequest, RepoSchema), 'unavailable');
    expect(calls).toBe(MAX_ATTEMPTS);
  });

  it('invalid params never reach the network', async () => {
    let calls = 0;
    const countingFetch: typeof fetch = async () => {
      calls += 1;
      return new Response('{}');
    };
    await expect(
      client({ fetch: countingFetch }).get(
        { endpoint: 'repository', params: { ns: 'library', repo: '../../v2/users/x' } },
        RepoSchema,
      ),
    ).rejects.toThrow(TypeError);
    expect(calls).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Against a mocked Docker Hub (MSW)
// ---------------------------------------------------------------------------

describe('createDockerHubClient with MSW', () => {
  const HUB = 'https://hub.docker.com';

  it('reads a repository from the mocked Docker Hub origin', async () => {
    let userAgent: string | null = null;
    msw.use(
      http.get(`${HUB}/v2/namespaces/:ns/repositories/:repo`, ({ request, params }) => {
        userAgent = request.headers.get('User-Agent');
        return HttpResponse.json({ ...NGINX, namespace: params.ns, name: params.repo });
      }),
    );
    expect(await client({ baseUrl: HUB }).get(repoRequest, RepoSchema)).toEqual(NGINX);
    expect(userAgent).toBe(USER_AGENT);
  });

  it('maps a mocked 404 to not_found', async () => {
    msw.use(
      http.get(`${HUB}/v2/namespaces/:ns/repositories/:repo`, () =>
        HttpResponse.json({ message: 'object not found', errinfo: {} }, { status: 404 }),
      ),
    );
    await rejectsWith(client({ baseUrl: HUB }).get(repoRequest, RepoSchema), 'not_found', {
      status: 404,
    });
  });
});
