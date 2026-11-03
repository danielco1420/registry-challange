import { describe, expect, it } from 'vitest';

import { blend, contrastRatio, relativeLuminance } from './contrast';

describe('blend', () => {
  it('composites a translucent color over an opaque backdrop', () => {
    expect(blend('#ffffff', 0.5, '#000000')).toBe('#808080');
    expect(blend('#dc2626', 0.9, '#ffffff')).toBe('#e03c3c');
  });

  it('returns the color at alpha 1 and the backdrop at alpha 0', () => {
    expect(blend('#15803d', 1, '#ffffff')).toBe('#15803d');
    expect(blend('#15803d', 0, '#ffffff')).toBe('#ffffff');
  });

  it('rejects an alpha outside 0 to 1', () => {
    expect(() => blend('#15803d', 1.5, '#ffffff')).toThrow(RangeError);
    expect(() => blend('#15803d', Number.NaN, '#ffffff')).toThrow(RangeError);
  });
});

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
