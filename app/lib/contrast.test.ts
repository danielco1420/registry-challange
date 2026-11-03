import { describe, expect, it } from 'vitest';

import { contrastRatio, relativeLuminance } from './contrast';

describe('relativeLuminance', () => {
  it('is 0 for black and 1 for white', () => {
    expect(relativeLuminance('#000000')).toBe(0);
    expect(relativeLuminance('#FFFFFF')).toBe(1);
  });

  it('rejects anything but #rrggbb', () => {
    expect(() => relativeLuminance('#fff')).toThrow(/#rrggbb/);
    expect(() => relativeLuminance('oklch(0.5 0 0)')).toThrow(/#rrggbb/);
  });
});

describe('contrastRatio', () => {
  it('is 21 for black on white and 1 for a color on itself', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBe(21);
    expect(contrastRatio('#15803d', '#15803d')).toBe(1);
  });

  it("doesn't depend on argument order", () => {
    expect(contrastRatio('#ffffff', '#767676')).toBeCloseTo(contrastRatio('#767676', '#ffffff'));
  });

  it('matches known WCAG values', () => {
    // #767676 is the lightest gray that passes 4.5:1 on white.
    expect(contrastRatio('#767676', '#ffffff')).toBeCloseTo(4.54, 2);
  });
});
