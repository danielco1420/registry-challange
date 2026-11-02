import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { formatCompactNumber, formatRelativeDate, formatSize } from './format';

const NOW = '2026-11-02T12:00:00.000Z';

describe('formatRelativeDate', () => {
  it('formats a past date as "... ago"', () => {
    const threeDaysAgo = '2026-10-30T12:00:00.000Z';
    const { relative } = formatRelativeDate(threeDaysAgo, NOW);
    assert.equal(relative, '3 days ago');
  });

  it('formats a future date as "in ..."', () => {
    const inTwoHours = '2026-11-02T14:00:00.000Z';
    const { relative } = formatRelativeDate(inTwoHours, NOW);
    assert.equal(relative, 'in 2 hours');
  });

  it('formats the same instant as "now"', () => {
    const { relative } = formatRelativeDate(NOW, NOW);
    assert.equal(relative, 'now');
  });

  it('includes an absolute date-time tooltip string', () => {
    const { absolute } = formatRelativeDate('2026-10-30T16:12:00.000Z', NOW);
    assert.match(absolute, /Oct 30, 2026/);
  });

  it('accepts epoch milliseconds and Date objects', () => {
    const now = new Date(NOW);
    const oneHourAgoMs = now.getTime() - 60 * 60 * 1000;
    assert.equal(formatRelativeDate(oneHourAgoMs, now).relative, '1 hour ago');
    assert.equal(formatRelativeDate(new Date(oneHourAgoMs), now).relative, '1 hour ago');
  });
});

describe('formatCompactNumber', () => {
  it('formats billions compactly', () => {
    assert.equal(formatCompactNumber(1_200_000_000), '1.2B');
  });

  it('formats small numbers unchanged', () => {
    assert.equal(formatCompactNumber(42), '42');
  });

  it('returns "—" for non-finite input', () => {
    assert.equal(formatCompactNumber(NaN), '—');
    assert.equal(formatCompactNumber(Infinity), '—');
  });
});

describe('formatSize', () => {
  it('formats a decimal megabyte size', () => {
    assert.equal(formatSize(62_592_256), '62.6 MB');
  });

  it('formats a decimal gigabyte size', () => {
    assert.equal(formatSize(1_234_000_000), '1.2 GB');
  });

  it('returns "—" for zero size', () => {
    assert.equal(formatSize(0), '—');
  });

  it('returns "—" for undefined or null size', () => {
    assert.equal(formatSize(undefined), '—');
    assert.equal(formatSize(null), '—');
  });

  it('returns "—" for negative or non-finite size', () => {
    assert.equal(formatSize(-5), '—');
    assert.equal(formatSize(NaN), '—');
  });
});
