import { describe, expect, it, vi } from 'vitest';

import { createMissingKeyHandler } from './i18next';
import i18next from './i18next';

describe('createMissingKeyHandler', () => {
  it('throws in dev so a missing key is surfaced immediately', () => {
    const handler = createMissingKeyHandler(true);

    expect(() => handler(['en'], 'common', 'does.not.exist')).toThrow(
      /missing key "does\.not\.exist" in namespace "common"/,
    );
  });

  it('logs instead of throwing outside dev', () => {
    const handler = createMissingKeyHandler(false);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    expect(() => handler(['en'], 'common', 'does.not.exist')).not.toThrow();
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('does.not.exist'));

    errorSpy.mockRestore();
  });
});

describe('i18next instance', () => {
  it('is initialized synchronously with English resources, fixed to en', () => {
    expect(i18next.isInitialized).toBe(true);
    expect(i18next.language).toBe('en');
    expect(i18next.t('home.heading')).toBe("Danny's Dockers");
  });
});
