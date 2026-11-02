import * as v from 'valibot';
import { describe, expect, it } from 'vitest';
import { searchParamsToObject } from './params';
import { PARAM_CASES, PARAM_SCHEMAS } from './params.cases';

describe('param schemas', () => {
  it.each(PARAM_CASES)('$schema: $label', ({ schema, input, valid, output }) => {
    const result = v.safeParse(PARAM_SCHEMAS[schema], input);
    expect(result.success).toBe(valid);
    if (result.success && output !== undefined) expect(result.output).toEqual(output);
  });
});

describe('searchParamsToObject', () => {
  it.each([
    { label: 'repeated key, empty first value', input: 'sort=&sort=stars', output: {} },
    {
      label: 'repeated key, non-empty first value',
      input: 'sort=stars&sort=pulls',
      output: { sort: 'stars' },
    },
    { label: '__proto__ key is plain data', input: '__proto__=x', output: { ['__proto__']: 'x' } },
  ])('$label', ({ input, output }) => {
    expect(searchParamsToObject(new URLSearchParams(input))).toEqual(output);
  });

  it('returns an object without a prototype', () => {
    expect(Object.getPrototypeOf(searchParamsToObject(new URLSearchParams('a=1')))).toBeNull();
  });
});
