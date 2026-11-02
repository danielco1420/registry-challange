/**
 * Tests for `getCached` and its responses: the cache, the Docker Hub client and
 * the upstream budget wired together. A fake `fetch` stands in for Docker
 * Hub, fake timers drive the cache's `Date`, and the budget gets its own
 * clock, advanced in step.
 */
import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it, vi } from 'vitest';
import * as v from 'valibot';
import { BUDGET_WINDOW_MS, createUpstreamBudget, type UpstreamBudget } from './budget.server';
import { createCache } from './cache.server';
import {
  createDockerHubClient,
  UpstreamError,
  type DockerHubClient,
  type UpstreamRequest,
} from './dockerhub.server';
import {
  UNAVAILABLE_RETRY_AFTER_FALLBACK_SECONDS,
  UpstreamUnavailableError,
  cachedJson,
  createGetCached,
  getCached as sharedGetCached,
  upstreamUnavailableResponse,
  type GetCached,
  type UpstreamUnavailableBody,
} from './upstream.server';

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

const RepoSchema = v.object({ name: v.string(), pull_count: v.number() });
type Repo = v.InferOutput<typeof RepoSchema>;

const repoRequest = (repo: string): UpstreamRequest => ({
  endpoint: 'repository',
  params: { ns: 'library', repo },
});

/** One queued upstream answer: a status and JSON body, plus optional headers. */
interface Reply {
  status: number;
  body?: unknown;
  headers?: Record<string, string>;
}

const ok = (name: string): Reply => ({ status: 200, body: { name, pull_count: 1 } });
const fail = (status: number, headers?: Record<string, string>): Reply => ({
  status,
  body: { message: 'error' },
  headers,
});

/** TTL used by most tests, in seconds. */
const TTL = 10;

let replies: Reply[];
let sent: string[];
let budgetTime: number;
let budget: UpstreamBudget;
let client: DockerHubClient;
let getCached: GetCached;

/** Builds the stack with a budget of `limit` per minute. */
function setup(limit: number) {
  budget = createUpstreamBudget({ limit, now: () => budgetTime });
  client = createDockerHubClient({
    baseUrl: 'https://hub.example.test',
    timeoutMs: 1000,
    budget,
    sleep: async () => {},
    random: () => 0,
    fetch: async (input) => {
      sent.push(String(input));
      const reply = replies.shift() ?? fail(500);
      return Response.json(reply.body ?? {}, { status: reply.status, headers: reply.headers });
    },
  });
  getCached = createGetCached({ cache: createCache({ maxEntries: 100, jitter: 0 }), budget });
}

/** Reads `library/<repo>` through the facade. */
const read = (repo: string) =>
  getCached<Repo>(`repo:library/${repo}`, TTL, () => client.get(repoRequest(repo), RepoSchema));

/** Moves both clocks forward. */
function advance(ms: number) {
  vi.advanceTimersByTime(ms);
  budgetTime += ms;
}

/** Lets a background refresh (fetch, retry, body read) settle. */
async function flush() {
  for (let i = 0; i < 10; i += 1) await new Promise<void>((resolve) => setImmediate(resolve));
}

async function rejectsUnavailable(
  promise: Promise<unknown>,
  reason: UpstreamUnavailableError['reason'],
): Promise<UpstreamUnavailableError> {
  try {
    await promise;
  } catch (error) {
    assert.ok(error instanceof UpstreamUnavailableError, `got ${String(error)}`);
    assert.equal(error.reason, reason);
    return error;
  }
  assert.fail('expected an UpstreamUnavailableError');
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'], now: 0 });
  replies = [];
  sent = [];
  budgetTime = 0;
});

afterEach(() => {
  vi.useRealTimers();
});

// ---------------------------------------------------------------------------
// Budget counting
// ---------------------------------------------------------------------------

describe('getCached: budget counting', () => {
  it('a miss takes one slot; hits take none', async () => {
    setup(10);
    replies = [ok('nginx')];

    assert.deepEqual(await read('nginx'), {
      value: { name: 'nginx', pull_count: 1 },
      status: 'MISS',
      ageMs: 0,
      degraded: false,
    });
    for (let i = 0; i < 5; i += 1) assert.equal((await read('nginx')).status, 'HIT');

    assert.equal(sent.length, 1);
    assert.equal(budget.remaining(), 9);
  });

  it('single-flight followers take no slot', async () => {
    setup(10);
    replies = [ok('nginx')];
    const results = await Promise.all(Array.from({ length: 5 }, () => read('nginx')));
    assert.ok(results.every((r) => r.status === 'MISS' && r.value.name === 'nginx'));
    assert.equal(sent.length, 1);
    assert.equal(budget.remaining(), 9);
  });

  it('retries take a slot each', async () => {
    setup(10);
    replies = [fail(503), ok('nginx')];
    assert.equal((await read('nginx')).status, 'MISS');
    assert.equal(sent.length, 2);
    assert.equal(budget.remaining(), 8);
  });

  it('a background refresh takes a slot', async () => {
    setup(10);
    replies = [ok('nginx'), ok('nginx')];
    await read('nginx');
    advance(TTL * 1000);
    assert.equal((await read('nginx')).status, 'STALE');
    await flush();
    assert.equal(sent.length, 2);
    assert.equal(budget.remaining(), 8);
  });
});

// ---------------------------------------------------------------------------
// Budget exhausted: stale or 503
// ---------------------------------------------------------------------------

describe('getCached: budget exhausted', () => {
  it('serves a stale entry as degraded without calling upstream', async () => {
    setup(2);
    replies = [ok('nginx'), ok('redis')];
    await read('nginx');
    await read('redis');
    assert.equal(budget.isExhausted(), true);

    advance(TTL * 1000 + 500); // nginx is stale; the budget window hasn't reset
    const result = await read('nginx');
    await flush();
    assert.deepEqual(result, {
      value: { name: 'nginx', pull_count: 1 },
      status: 'STALE',
      ageMs: TTL * 1000 + 500,
      degraded: true,
    });
    assert.equal(sent.length, 2, 'no upstream call');

    const response = cachedJson(result.value, result, TTL);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('X-Cache'), 'STALE');
    assert.equal(response.headers.get('Cache-Control'), 'no-store');
    assert.equal(response.headers.get('Age'), String(TTL));
    assert.equal(response.headers.get('Retry-After'), null);
    assert.deepEqual(await response.json(), { name: 'nginx', pull_count: 1 });
  });

  it('a refresh that takes the last slot is not degraded', async () => {
    setup(2);
    replies = [ok('nginx'), ok('nginx')];
    await read('nginx');
    advance(TTL * 1000);

    const result = await read('nginx'); // its refresh takes the last slot
    assert.equal(result.status, 'STALE');
    assert.equal(result.degraded, false);
    await flush();
    assert.equal(sent.length, 2, 'the refresh was sent');
    assert.equal(budget.isExhausted(), true);
  });

  it('with no entry, throws UpstreamUnavailableError with seconds until the budget resets', async () => {
    setup(1);
    replies = [ok('nginx')];
    await read('nginx');
    advance(15_000);

    const error = await rejectsUnavailable(read('redis'), 'budget_exhausted');
    assert.equal(error.retryAfterSeconds, 45);
    assert.ok(error.cause instanceof UpstreamError);
    assert.equal(error.cause.kind, 'budget_exhausted');
    assert.equal(sent.length, 1, 'no upstream call');
  });

  it('503 response shape', async () => {
    const response = upstreamUnavailableResponse(
      new UpstreamUnavailableError('budget_exhausted', 45),
    );
    assert.equal(response.status, 503);
    assert.equal(response.headers.get('Retry-After'), '45');
    assert.equal(response.headers.get('Cache-Control'), 'no-store');
    assert.match(response.headers.get('Content-Type') ?? '', /application\/json/);
    const body: UpstreamUnavailableBody = await response.json();
    assert.deepEqual(body, {
      error: {
        code: 'upstream_unavailable',
        message: 'Docker Hub is unavailable right now. Try again later.',
      },
    });
  });

  it('Retry-After is at least 1 and a whole number', () => {
    assert.equal(new UpstreamUnavailableError('upstream_failed', 0).retryAfterSeconds, 1);
    assert.equal(new UpstreamUnavailableError('upstream_failed', 2.2).retryAfterSeconds, 3);
    assert.equal(
      upstreamUnavailableResponse({ retryAfterSeconds: 0 }).headers.get('Retry-After'),
      '1',
    );
  });

  it('recovers once the budget window resets', async () => {
    setup(1);
    replies = [ok('nginx'), ok('redis'), ok('nginx')];
    await read('nginx'); // takes the only slot, at t = 0
    await rejectsUnavailable(read('redis'), 'budget_exhausted');
    advance(TTL * 1000);
    assert.equal((await read('nginx')).degraded, true);
    await flush(); // its refresh is refused by the budget

    advance(BUDGET_WINDOW_MS); // t = 70 s: the slot from t = 0 is free again
    assert.equal(budget.isExhausted(), false);
    const redis = await read('redis');
    assert.equal(redis.status, 'MISS');
    assert.equal(redis.degraded, false);

    advance(BUDGET_WINDOW_MS); // t = 130 s: free again
    const stale = await read('nginx');
    assert.equal(stale.status, 'STALE');
    assert.equal(stale.degraded, true, 'its last refresh failed');
    await flush(); // this refresh succeeds
    assert.deepEqual(await read('nginx'), {
      value: { name: 'nginx', pull_count: 1 },
      status: 'HIT',
      ageMs: 0,
      degraded: false,
    });
    assert.equal(sent.length, 3);
  });
});

// ---------------------------------------------------------------------------
// Upstream failing
// ---------------------------------------------------------------------------

describe('getCached: upstream failing', () => {
  it('a routine stale read is not degraded; a failed refresh makes it degraded', async () => {
    setup(100);
    replies = [ok('nginx'), fail(500), fail(500)];
    await read('nginx');
    advance(TTL * 1000);

    const first = await read('nginx');
    assert.equal(first.status, 'STALE');
    assert.equal(first.degraded, false);
    await flush(); // the refresh fails (500, retried once)

    const second = await read('nginx');
    assert.equal(second.status, 'STALE');
    assert.equal(second.degraded, true);
    assert.equal(second.value.name, 'nginx');
    assert.equal(cachedJson(second.value, second, TTL).headers.get('Cache-Control'), 'no-store');
  });

  it('with no entry, 5xx becomes UpstreamUnavailableError with the fallback Retry-After', async () => {
    setup(100);
    replies = [fail(500), fail(502)];
    const error = await rejectsUnavailable(read('nginx'), 'upstream_failed');
    assert.equal(error.retryAfterSeconds, UNAVAILABLE_RETRY_AFTER_FALLBACK_SECONDS);
    assert.ok(error.cause instanceof UpstreamError);
    assert.equal(error.cause.kind, 'unavailable');
  });

  it("passes an upstream 429's Retry-After on", async () => {
    setup(100);
    replies = [fail(429, { 'Retry-After': '30' })];
    const error = await rejectsUnavailable(read('nginx'), 'upstream_failed');
    assert.equal(error.retryAfterSeconds, 30);
    assert.equal(sent.length, 1, 'a 30 s wait is not retried in-request');
  });

  it('a payload that fails the schema is unavailable too', async () => {
    setup(100);
    replies = [{ status: 200, body: { unexpected: true } }];
    const error = await rejectsUnavailable(read('nginx'), 'upstream_failed');
    assert.ok(error.cause instanceof UpstreamError);
    assert.equal(error.cause.kind, 'bad_payload');
  });

  it('a retry refused by the budget waits for the budget too', async () => {
    setup(1);
    replies = [fail(503), ok('nginx')];
    const error = await rejectsUnavailable(read('nginx'), 'upstream_failed');
    assert.equal(sent.length, 1, 'the retry was not sent');
    assert.equal(error.retryAfterSeconds, BUDGET_WINDOW_MS / 1000);
  });

  it('rethrows a 404 unchanged and caches nothing', async () => {
    setup(100);
    replies = [fail(404), ok('nginx')];
    await assert.rejects(
      read('nginx'),
      (error) => error instanceof UpstreamError && error.kind === 'not_found',
    );
    assert.equal((await read('nginx')).status, 'MISS');
  });

  it('rethrows programming errors unchanged', async () => {
    setup(100);
    await assert.rejects(
      getCached('repo:bad', TTL, () => client.get(repoRequest('../x'), RepoSchema)),
      TypeError,
    );
    assert.equal(sent.length, 0);
    assert.equal(budget.remaining(), 100, 'the URL is checked before a slot is taken');
  });
});

// ---------------------------------------------------------------------------
// Fresh responses
// ---------------------------------------------------------------------------

describe('cachedJson', () => {
  it('HIT and MISS carry the TTL as max-age, with Age and X-Cache', async () => {
    const miss = cachedJson({ a: 1 }, { status: 'MISS', ageMs: 0 }, 300);
    assert.equal(miss.status, 200);
    assert.equal(miss.headers.get('X-Cache'), 'MISS');
    assert.equal(miss.headers.get('Cache-Control'), 'public, max-age=300');
    assert.equal(miss.headers.get('Age'), '0');
    assert.deepEqual(await miss.json(), { a: 1 });

    const hit = cachedJson({ a: 1 }, { status: 'HIT', ageMs: 61_900 }, 300);
    assert.equal(hit.headers.get('X-Cache'), 'HIT');
    assert.equal(hit.headers.get('Age'), '61');
  });
});

describe('shared getCached', () => {
  it('is wired to the shared cache and budget', async () => {
    const result = await sharedGetCached('test:shared', 60, async () => 'value');
    assert.deepEqual(result, { value: 'value', status: 'MISS', ageMs: 0, degraded: false });
  });
});
