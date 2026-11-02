/**
 * Unit tests for the proxy-wide upstream budget, on Node's built-in test
 * runner with an injected clock.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'vitest';
import { BUDGET_WINDOW_MS, createUpstreamBudget, upstreamBudget } from './budget.server';

function setup(limit: number) {
  let time = 1_000;
  const budget = createUpstreamBudget({ limit, now: () => time });
  return {
    budget,
    advance(ms: number) {
      time += ms;
    },
  };
}

describe('createUpstreamBudget', () => {
  it('rejects invalid options', () => {
    assert.throws(() => createUpstreamBudget({ limit: 0 }), RangeError);
    assert.throws(() => createUpstreamBudget({ limit: 1.5 }), RangeError);
    assert.throws(() => createUpstreamBudget({ limit: 1, windowMs: 0 }), RangeError);
  });

  it('counts each acquisition and refuses past the limit without counting the refusal', () => {
    const { budget } = setup(3);
    assert.equal(budget.remaining(), 3);
    assert.equal(budget.isExhausted(), false);
    assert.equal(budget.retryAfterSeconds(), 0);

    assert.equal(budget.tryAcquire(), true);
    assert.equal(budget.tryAcquire(), true);
    assert.equal(budget.remaining(), 1);
    assert.equal(budget.tryAcquire(), true);

    assert.equal(budget.isExhausted(), true);
    assert.equal(budget.remaining(), 0);
    for (let i = 0; i < 5; i += 1) assert.equal(budget.tryAcquire(), false);
    assert.equal(budget.remaining(), 0);
  });

  it('reports the seconds until the oldest slot frees up', () => {
    const { budget, advance } = setup(2);
    budget.tryAcquire();
    advance(20_000);
    budget.tryAcquire();
    assert.equal(budget.retryAfterSeconds(), 40);
    advance(39_500);
    assert.equal(budget.retryAfterSeconds(), 1, 'rounds up, never 0 while exhausted');
  });

  it('frees each slot exactly one window after it was taken (sliding window)', () => {
    const { budget, advance } = setup(2);
    budget.tryAcquire(); // t = 0
    advance(30_000);
    budget.tryAcquire(); // t = 30 s
    assert.equal(budget.tryAcquire(), false);

    advance(BUDGET_WINDOW_MS - 30_000 - 1); // t = 60 s - 1 ms: both still in the window
    assert.equal(budget.tryAcquire(), false);
    advance(1); // t = 60 s: the first slot is free, the second isn't
    assert.equal(budget.remaining(), 1);
    assert.equal(budget.tryAcquire(), true);
    assert.equal(budget.tryAcquire(), false);
    assert.equal(budget.retryAfterSeconds(), 30);
  });

  it('never allows more than the limit in any window, even across a window edge', () => {
    const { budget, advance } = setup(5);
    let granted = 0;
    // One attempt per second for 3 minutes, 4 at a time: far more than the budget allows.
    const grantedAt: number[] = [];
    for (let second = 0; second < 180; second += 1) {
      for (let i = 0; i < 4; i += 1) {
        if (budget.tryAcquire()) {
          granted += 1;
          grantedAt.push(second);
        }
      }
      advance(1000);
    }
    assert.equal(granted, 15, '5 per minute for 3 minutes');
    for (const start of grantedAt) {
      const inWindow = grantedAt.filter((t) => t >= start && t < start + 60).length;
      assert.ok(inWindow <= 5, `at most 5 in the minute from ${start} s, got ${inWindow}`);
    }
  });

  it('resets fully after a quiet window', () => {
    const { budget, advance } = setup(3);
    while (budget.tryAcquire());
    assert.equal(budget.isExhausted(), true);
    advance(BUDGET_WINDOW_MS);
    assert.equal(budget.remaining(), 3);
    assert.equal(budget.retryAfterSeconds(), 0);
  });

  it('exports a shared budget sized by UPSTREAM_BUDGET_PER_MIN (150 by default)', () => {
    assert.equal(upstreamBudget.limit, 150);
  });
});
