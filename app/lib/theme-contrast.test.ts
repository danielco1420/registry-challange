import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { AA_NON_TEXT, AA_TEXT, contrastRatio } from './contrast';

// Reads the design tokens straight from app/app.css, so a palette change that
// breaks contrast fails `pnpm test` (questionnaire D20 follow-up).
const css = readFileSync(fileURLToPath(new URL('../app.css', import.meta.url)), 'utf8');

function tokens(selector: ':root' | '.dark'): Record<string, string> {
  const escaped = selector.replace('.', '\\.');
  const block = new RegExp(`^${escaped}\\s*\\{([^}]*)\\}`, 'm').exec(css)?.[1];
  if (!block) throw new Error(`No "${selector}" block in app/app.css`);
  return Object.fromEntries(
    [...block.matchAll(/--([\w-]+):\s*(#[0-9a-f]{6})\s*;/gi)].map(([, name, value]) => [
      name,
      value,
    ]),
  ) as Record<string, string>;
}

/** [foreground token, background token, minimum ratio] */
const PAIRS: [string, string, number][] = [
  // Text
  ['foreground', 'background', AA_TEXT],
  ['card-foreground', 'card', AA_TEXT],
  ['popover-foreground', 'popover', AA_TEXT],
  ['primary-foreground', 'primary', AA_TEXT],
  ['secondary-foreground', 'secondary', AA_TEXT],
  ['muted-foreground', 'background', AA_TEXT],
  ['muted-foreground', 'muted', AA_TEXT],
  ['accent-foreground', 'accent', AA_TEXT],
  ['destructive', 'background', AA_TEXT],
  ['destructive-foreground', 'destructive', AA_TEXT],
  // Green accent as text (links, highlighted labels)
  ['brand', 'background', AA_TEXT],
  ['brand', 'card', AA_TEXT],
  ['brand', 'muted', AA_TEXT],
  ['brand', 'accent', AA_TEXT],
  // Focus rings (non-text, SC 1.4.11)
  ['ring', 'background', AA_NON_TEXT],
  ['ring', 'card', AA_NON_TEXT],
  ['ring', 'popover', AA_NON_TEXT],
  ['ring', 'muted', AA_NON_TEXT],
];

describe.each([
  ['light', ':root'],
  ['dark', '.dark'],
] as const)('%s theme tokens', (_theme, selector) => {
  const palette = tokens(selector);

  it.each(PAIRS)('%s on %s meets %s:1', (fg, bg, minimum) => {
    const fgColor = palette[fg];
    const bgColor = palette[bg];
    expect(fgColor, `--${fg} missing`).toBeDefined();
    expect(bgColor, `--${bg} missing`).toBeDefined();
    expect(contrastRatio(fgColor as string, bgColor as string)).toBeGreaterThanOrEqual(minimum);
  });

  it('uses a light green accent, with a green tone for brand text and the focus ring', () => {
    for (const name of ['primary', 'brand', 'ring']) {
      const hex = palette[name] ?? '';
      const [r, g, b] = [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16)) as [
        number,
        number,
        number,
      ];
      expect(g, `--${name} ${hex} should be green`).toBeGreaterThan(Math.max(r, b));
    }
  });
});
