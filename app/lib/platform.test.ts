import { describe, expect, it } from 'vitest';

import { platformLabel, shortDigest } from './platform';

describe('platformLabel', () => {
  it.each([
    [{ os: 'linux', arch: 'amd64' }, 'linux/amd64'],
    [{ os: 'linux', arch: 'arm64', variant: 'v8' }, 'linux/arm64/v8'],
    [{ os: 'windows', arch: 'amd64', variant: undefined }, 'windows/amd64'],
    [{ os: '', arch: 'arm', variant: 'v7' }, 'arm/v7'],
  ])('%o → %s', (image, label) => {
    expect(platformLabel(image)).toBe(label);
  });
});

describe('shortDigest', () => {
  it('keeps the algorithm and the first 12 hex characters', () => {
    expect(
      shortDigest('sha256:9b6786d8d129fe8e4a2e19a9cb4aebeb44bd31fb52377b7ef1db327f56e0b951'),
    ).toBe('sha256:9b6786d8d129');
  });

  it('returns a short digest as is', () => {
    expect(shortDigest('sha256:abc')).toBe('sha256:abc');
  });

  it('handles a digest without an algorithm', () => {
    expect(shortDigest('9b6786d8d129fe8e4a2e')).toBe('9b6786d8d129');
  });
});
