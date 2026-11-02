/**
 * Date, number and size formatting (D26, RISKS.md 4.3 / 4.6).
 *
 * Everything here goes through `Intl` — no manual date-math or hand-rolled
 * number formatting. Locale is fixed to `en-US` for now: `app/i18n` is still
 * an empty placeholder (no locale detection wired up yet), so these take no
 * locale argument. When i18n lands, pass a locale through instead of adding
 * a second set of helpers.
 */

const LOCALE = 'en-US';

// ---------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------

/** `Intl.RelativeTimeFormat` units, from largest to smallest, with their length in ms. */
const RELATIVE_UNITS: { unit: Intl.RelativeTimeFormatUnit; ms: number }[] = [
  { unit: 'year', ms: 365 * 24 * 60 * 60 * 1000 },
  { unit: 'month', ms: 30 * 24 * 60 * 60 * 1000 },
  { unit: 'day', ms: 24 * 60 * 60 * 1000 },
  { unit: 'hour', ms: 60 * 60 * 1000 },
  { unit: 'minute', ms: 60 * 1000 },
  { unit: 'second', ms: 1000 },
];

const relativeTimeFormatter = new Intl.RelativeTimeFormat(LOCALE, { numeric: 'auto' });
const absoluteDateFormatter = new Intl.DateTimeFormat(LOCALE, {
  dateStyle: 'medium',
  timeStyle: 'short',
});

export interface FormattedDate {
  /** e.g. "3 days ago" or "in 2 hours". */
  relative: string;
  /** e.g. "Oct 30, 2026, 4:12 PM" — for a tooltip/title on the relative string. */
  absolute: string;
}

/**
 * Relative date (past or future, "just now" within a second either way) plus
 * an absolute date-time string for a tooltip. Accepts an ISO string, a
 * `Date`, or epoch milliseconds. `now` defaults to the current time and
 * exists so tests don't depend on wall-clock time.
 */
export function formatRelativeDate(
  input: string | number | Date,
  now: string | number | Date = Date.now(),
): FormattedDate {
  const date = input instanceof Date ? input : new Date(input);
  const reference = now instanceof Date ? now : new Date(now);
  const absolute = absoluteDateFormatter.format(date);

  const diffMs = date.getTime() - reference.getTime();
  const absDiffMs = Math.abs(diffMs);

  for (const { unit, ms } of RELATIVE_UNITS) {
    if (absDiffMs >= ms || unit === 'second') {
      const value = Math.round(diffMs / ms);
      return { relative: relativeTimeFormatter.format(value, unit), absolute };
    }
  }

  // Unreachable: the loop always matches on 'second'. Kept for type safety.
  return { relative: relativeTimeFormatter.format(0, 'second'), absolute };
}

// ---------------------------------------------------------------------------
// Numbers
// ---------------------------------------------------------------------------

const compactNumberFormatter = new Intl.NumberFormat(LOCALE, {
  notation: 'compact',
  maximumFractionDigits: 1,
});

/** Compact number, e.g. `1234567890` -> `"1.2B"`. `NaN`/non-finite -> `"—"`. */
export function formatCompactNumber(value: number): string {
  if (!Number.isFinite(value)) return '—';
  return compactNumberFormatter.format(value);
}

// ---------------------------------------------------------------------------
// Sizes
// ---------------------------------------------------------------------------

/** Decimal (1000-based) byte units, smallest to largest, matching Docker Hub's own display. */
const SIZE_UNITS: { unit: Intl.NumberFormatOptions['unit']; factor: number }[] = [
  { unit: 'terabyte', factor: 1000 ** 4 },
  { unit: 'gigabyte', factor: 1000 ** 3 },
  { unit: 'megabyte', factor: 1000 ** 2 },
  { unit: 'kilobyte', factor: 1000 },
  { unit: 'byte', factor: 1 },
];

/**
 * Decimal size, e.g. `62592256` -> `"62.6 MB"`. `0`, `undefined`, negative or
 * non-finite sizes return `"—"` (RISKS.md 4.3: `full_size` can legitimately
 * be `0` for an unknown-size tag).
 */
export function formatSize(sizeInBytes: number | undefined | null): string {
  if (sizeInBytes == null || !Number.isFinite(sizeInBytes) || sizeInBytes <= 0) return '—';

  const { unit, factor } = SIZE_UNITS.find(({ factor }) => sizeInBytes >= factor) ?? {
    unit: 'byte' as const,
    factor: 1,
  };

  const formatter = new Intl.NumberFormat(LOCALE, {
    style: 'unit',
    unit,
    unitDisplay: 'short',
    maximumFractionDigits: unit === 'byte' ? 0 : 1,
  });

  return formatter.format(sizeInBytes / factor);
}
