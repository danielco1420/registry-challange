import { describe, expect, it } from 'vitest';

import { initials } from './initials';

describe('initials', () => {
  it.each([
    ['nginx', 'N'],
    ['fluent-bit', 'FB'],
    ['hello_world', 'HW'],
    ['node.js', 'NJ'],
    ['fluent/fluent-bit', 'FF'],
    ['my-very-long-name', 'MV'],
    ['3proxy', '3'],
    ['-leading-dash', 'LD'],
    ['élan', 'É'],
  ])('%s -> %s', (name, expected) => {
    expect(initials(name)).toBe(expected);
  });

  it.each(['', '---', '  '])('falls back to "?" for %j', (name) => {
    expect(initials(name)).toBe('?');
  });
});
