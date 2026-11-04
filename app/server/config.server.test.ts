import { describe, expect, it } from 'vitest';

import { ConfigError, parseEnv } from './config.server';

describe('parseEnv: PUBLIC_ORIGIN', () => {
  it.each([undefined, '', '  '])(
    'is unset for %j, so same-origin checks use request.url',
    (value) => {
      expect(parseEnv({ PUBLIC_ORIGIN: value }).app.publicOrigin).toBeUndefined();
    },
  );

  it('normalizes to a bare origin', () => {
    expect(parseEnv({ PUBLIC_ORIGIN: ' https://Registry.Example/ ' }).app.publicOrigin).toBe(
      'https://registry.example',
    );
  });

  it.each(['registry.example', 'https://registry.example/app', 'https://u:p@registry.example'])(
    'rejects %s',
    (value) => {
      expect(() => parseEnv({ PUBLIC_ORIGIN: value })).toThrow(ConfigError);
    },
  );
});
