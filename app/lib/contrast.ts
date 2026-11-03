// WCAG 2.x contrast ratio for `#rrggbb` colors. Used by the theme token tests
// (`app/lib/theme-contrast.test.ts`) to keep the brand palette readable.

/** WCAG 2.x AA minimums. */
export const AA_TEXT = 4.5;
/** Large text and non-text UI such as focus rings (SC 1.4.11). */
export const AA_NON_TEXT = 3;

function channels(hex: string): [number, number, number] {
  const match = /^#([0-9a-f]{6})$/i.exec(hex.trim());
  if (!match?.[1]) throw new Error(`Expected a #rrggbb color, got "${hex}"`);
  const value = Number.parseInt(match[1], 16);
  return [(value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff];
}

/** Relative luminance, 0 (black) to 1 (white). */
export function relativeLuminance(hex: string): number {
  const [r, g, b] = channels(hex).map((channel) => {
    const c = channel / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Contrast ratio between two colors, 1 to 21. Order doesn't matter. */
export function contrastRatio(a: string, b: string): number {
  const [lighter, darker] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x) as [
    number,
    number,
  ];
  return (lighter + 0.05) / (darker + 0.05);
}
