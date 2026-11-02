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

const SECOND_MS = 1000;
const DAY_MS = 24 * 60 * 60 * SECOND_MS;
const YEAR_MS = 365 * DAY_MS;

/**
 * `Intl.RelativeTimeFormat` units, from largest to smallest, with their length
 * in ms. A month is a twelfth of a year so that 12 months always make a year
 * (with 30-day months, 360-364 days would read "12 months ago").
 */
const RELATIVE_UNITS: { unit: Intl.RelativeTimeFormatUnit; ms: number }[] = [
  { unit: 'year', ms: YEAR_MS },
  { unit: 'month', ms: YEAR_MS / 12 },
  { unit: 'day', ms: DAY_MS },
  { unit: 'hour', ms: 60 * 60 * SECOND_MS },
  { unit: 'minute', ms: 60 * SECOND_MS },
  { unit: 'second', ms: SECOND_MS },
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

/** Returned for a missing or unparseable date. */
const UNKNOWN_DATE: FormattedDate = { relative: '—', absolute: '' };

function toDate(value: string | number | Date): Date {
  return value instanceof Date ? value : new Date(value);
}

/**
 * Relative date (past or future; `"now"` when less than a second apart) plus
 * an absolute date-time string for a tooltip. Accepts an ISO string, a
 * `Date`, or epoch milliseconds. A `null`/`undefined`/unparseable input
 * returns `{ relative: "—", absolute: "" }` instead of throwing, since
 * upstream date fields can be missing. `now` defaults to the current time and
 * exists so tests don't depend on wall-clock time.
 *
 * The count is truncated toward zero within the largest unit that fits, so it
 * never overflows into the next unit (59.9 minutes is "59 minutes ago", not
 * "60 minutes ago").
 */
export function formatRelativeDate(
  input: string | number | Date | null | undefined,
  now: string | number | Date = Date.now(),
): FormattedDate {
  if (input == null) return UNKNOWN_DATE;
  const date = toDate(input);
  const reference = toDate(now);
  if (Number.isNaN(date.getTime()) || Number.isNaN(reference.getTime())) return UNKNOWN_DATE;

  const absolute = absoluteDateFormatter.format(date);
  const diffMs = date.getTime() - reference.getTime();
  const absDiffMs = Math.abs(diffMs);

  const { unit, ms } = RELATIVE_UNITS.find(({ ms }) => absDiffMs >= ms) ?? {
    unit: 'second' as const,
    ms: SECOND_MS,
  };
  // `+ 0` turns -0 into 0 so sub-second diffs read "now" either way.
  const value = Math.trunc(diffMs / ms) + 0;
  return { relative: relativeTimeFormatter.format(value, unit), absolute };
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

interface SizeUnit {
  factor: number;
  fractionDigits: number;
  formatter: Intl.NumberFormat;
}

function sizeUnit(
  unit: string,
  factor: number,
  fractionDigits: number,
  unitDisplay: 'short' | 'long' = 'short',
): SizeUnit {
  return {
    factor,
    fractionDigits,
    formatter: new Intl.NumberFormat(LOCALE, {
      style: 'unit',
      unit,
      unitDisplay,
      maximumFractionDigits: fractionDigits,
    }),
  };
}

/**
 * Decimal (1000-based) byte units, smallest to largest, matching Docker Hub's
 * own display. Bytes use the long label: en-US short is the singular "byte"
 * ("512 byte").
 */
const SIZE_UNITS: SizeUnit[] = [
  sizeUnit('byte', 1, 0, 'long'),
  sizeUnit('kilobyte', 1000, 1),
  sizeUnit('megabyte', 1000 ** 2, 1),
  sizeUnit('gigabyte', 1000 ** 3, 1),
  sizeUnit('terabyte', 1000 ** 4, 1),
];

/** `value` rounded the way its formatter will round it. */
function roundTo(value: number, fractionDigits: number): number {
  const scale = 10 ** fractionDigits;
  return Math.round(value * scale) / scale;
}

/**
 * Decimal size, e.g. `62592256` -> `"62.6 MB"`. `0`, `undefined`, negative or
 * non-finite sizes return `"—"` (RISKS.md 4.3: `full_size` can legitimately
 * be `0` for an unknown-size tag). A value that would round up to 1000 moves
 * to the next unit (`999_970` -> `"1 MB"`, not `"1,000 kB"`).
 */
export function formatSize(sizeInBytes: number | undefined | null): string {
  if (sizeInBytes == null || !Number.isFinite(sizeInBytes) || sizeInBytes <= 0) return '—';

  // Largest unit the size reaches, then up one if rounding would show 1000.
  let index = 0;
  while (index < SIZE_UNITS.length - 1 && sizeInBytes >= SIZE_UNITS[index + 1]!.factor) index++;
  const current = SIZE_UNITS[index]!;
  if (
    index < SIZE_UNITS.length - 1 &&
    roundTo(sizeInBytes / current.factor, current.fractionDigits) >= 1000
  ) {
    index++;
  }

  const { factor, formatter } = SIZE_UNITS[index]!;
  return formatter.format(sizeInBytes / factor);
}
