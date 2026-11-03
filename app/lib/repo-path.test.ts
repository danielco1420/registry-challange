import { describe, expect, it } from 'vitest';

import { repoPath } from './repo-path';

describe('repoPath', () => {
  it('uses /_/{repo} for official images', () => {
    expect(repoPath('library', 'nginx')).toBe('/_/nginx');
  });

  it('uses /r/{ns}/{repo} for everything else', () => {
    expect(repoPath('fluent', 'fluent-bit')).toBe('/r/fluent/fluent-bit');
  });

  it('encodes each segment', () => {
    expect(repoPath('a b', 'c/d')).toBe('/r/a%20b/c%2Fd');
  });
});
