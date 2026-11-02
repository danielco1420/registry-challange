import assert from 'node:assert/strict';
import { describe, it } from 'vitest';
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

  it('formats sub-second differences as "now" in either direction', () => {
    const now = new Date(NOW).getTime();
    assert.equal(formatRelativeDate(now - 600, now).relative, 'now');
    assert.equal(formatRelativeDate(now + 600, now).relative, 'now');
    assert.equal(formatRelativeDate(now - 1000, now).relative, '1 second ago');
  });

  it('never rounds up into an overflowing count of the smaller unit', () => {
    const now = new Date(NOW).getTime();
    const minute = 60 * 1000;
    const day = 24 * 60 * minute;
    assert.equal(formatRelativeDate(now - 59.9 * minute, now).relative, '59 minutes ago');
    assert.equal(formatRelativeDate(now - 60 * minute, now).relative, '1 hour ago');
    assert.equal(formatRelativeDate(now - 364 * day, now).relative, '11 months ago');
    assert.equal(formatRelativeDate(now - 365 * day, now).relative, 'last year');
  });

  it('handles far past and far future dates', () => {
    assert.equal(formatRelativeDate('2013-06-01T00:00:00.000Z', NOW).relative, '13 years ago');
    assert.equal(formatRelativeDate('2126-11-02T12:00:00.000Z', NOW).relative, 'in 100 years');
  });

  it('returns "—" and no tooltip for missing or unparseable dates', () => {
    const unknown = { relative: '—', absolute: '' };
    assert.deepEqual(formatRelativeDate(null, NOW), unknown);
    assert.deepEqual(formatRelativeDate(undefined, NOW), unknown);
    assert.deepEqual(formatRelativeDate('not a date', NOW), unknown);
  });

  it('includes an absolute date-time tooltip string', () => {
    // Built from local-time components: the formatter uses the host time
    // zone, so a UTC instant could land on another calendar day.
    const { absolute } = formatRelativeDate(new Date(2026, 9, 30, 16, 12), NOW);
    assert.match(absolute, /^Oct 30, 2026, 4:12\sPM$/);
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

  it('formats bytes and kilobytes', () => {
    assert.equal(formatSize(1), '1 byte');
    assert.equal(formatSize(512), '512 bytes');
    assert.equal(formatSize(1_500), '1.5 kB');
  });

  it('moves to the next unit when rounding would show 1000', () => {
    assert.equal(formatSize(999_970), '1 MB');
    assert.equal(formatSize(999_960_000), '1 GB');
    assert.equal(formatSize(999_940), '999.9 kB');
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
    assert.equal(formatSize(Infinity), '—');
    assert.equal(formatSize(-Infinity), '—');
  });
});
