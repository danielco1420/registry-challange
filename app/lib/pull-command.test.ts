import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { pullByDigest, pullCommand } from './pull-command';

describe('pullCommand', () => {
  it('omits the namespace for official (library) images', () => {
    assert.equal(pullCommand('library', 'nginx', 'latest'), 'docker pull nginx:latest');
  });

  it('keeps the namespace for non-library images', () => {
    assert.equal(
      pullCommand('fluent', 'fluent-bit', '3.1.9'),
      'docker pull fluent/fluent-bit:3.1.9',
    );
  });

  it('only strips an exact `library` namespace, not a prefix match', () => {
    assert.equal(
      pullCommand('librarytools', 'nginx', '1.27'),
      'docker pull librarytools/nginx:1.27',
    );
  });

  it('is case-sensitive about the library namespace', () => {
    // Only the exact `library` namespace is stripped; params.ts already
    // enforces lowercase, but this guards the helper's own behavior.
    assert.equal(pullCommand('Library', 'nginx', 'latest'), 'docker pull Library/nginx:latest');
  });
});

describe('pullByDigest', () => {
  it('omits the namespace for official (library) images', () => {
    assert.equal(
      pullByDigest('library', 'nginx', 'sha256:abc123'),
      'docker pull nginx@sha256:abc123',
    );
  });

  it('keeps the namespace for non-library images', () => {
    assert.equal(
      pullByDigest('fluent', 'fluent-bit', 'sha256:def456'),
      'docker pull fluent/fluent-bit@sha256:def456',
    );
  });
});
