import { afterEach, describe, expect, it, vi } from 'vitest';

import i18next, { createMissingKeyHandler } from './i18next';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('createMissingKeyHandler', () => {
  it('throws in dev so a missing key is surfaced immediately', () => {
    const handler = createMissingKeyHandler(true);

    expect(() => handler(['en'], 'common', 'does.not.exist')).toThrow(
      /missing key "does\.not\.exist" in namespace "common"/,
    );
  });

  it('logs instead of throwing outside dev, once per key', () => {
    const handler = createMissingKeyHandler(false);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    expect(() => handler(['en'], 'common', 'does.not.exist')).not.toThrow();
    handler(['en'], 'common', 'does.not.exist');
    handler(['en'], 'common', 'also.missing');

    expect(errorSpy).toHaveBeenCalledTimes(2);
    expect(errorSpy).toHaveBeenNthCalledWith(1, expect.stringContaining('does.not.exist'));
    expect(errorSpy).toHaveBeenNthCalledWith(2, expect.stringContaining('also.missing'));
  });
});

describe('i18next instance', () => {
  it('is initialized synchronously with English resources, fixed to en', () => {
    expect(i18next.isInitialized).toBe(true);
    expect(i18next.language).toBe('en');
    expect(i18next.t('home.heading')).toBe("Danny's Dockers");
  });

  it('surfaces a missing key through t() in dev', () => {
    expect(import.meta.env.DEV).toBe(true);

    // @ts-expect-error -- keys are typed against the catalog, so a missing key doesn't compile either.
    expect(() => i18next.t('does.not.exist')).toThrow(/missing key "does\.not\.exist"/);
  });
});
