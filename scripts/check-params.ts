/**
 * Runs every case in `app/lib/params.cases.ts` against its schema and asserts
 * validity (and, where given, the parsed output). Vitest isn't set up yet
 * (#5), so this is a dependency-free stand-in invoked via `pnpm test`.
 */
import * as v from 'valibot';
import { PARAM_CASES, PARAM_SCHEMAS } from '../app/lib/params.cases';
import { searchParamsToObject } from '../app/lib/params';

let failures = 0;

const searchParamsCases: Array<{ label: string; input: string; output: Record<string, string> }> = [
  { label: 'repeated key, empty first value', input: 'sort=&sort=stars', output: {} },
  { label: 'repeated key, non-empty first value', input: 'sort=stars&sort=pulls', output: { sort: 'stars' } },
  { label: '__proto__ key is plain data', input: '__proto__=x', output: { ['__proto__']: 'x' } },
];

for (const { label, input, output } of searchParamsCases) {
  const actual = searchParamsToObject(new URLSearchParams(input));
  const expected = JSON.stringify(output);
  const got = JSON.stringify(actual);
  if (got !== expected) {
    failures += 1;
    console.error(`FAIL searchParamsToObject: ${label}\n  expected ${expected}, got ${got}`);
  }
}

for (const { schema, label, input, valid, output } of PARAM_CASES) {
  const result = v.safeParse(PARAM_SCHEMAS[schema], input);
  const problems: string[] = [];

  if (result.success !== valid) {
    problems.push(`expected valid=${valid}, got valid=${result.success}`);
  }
  if (result.success && valid && output !== undefined) {
    const actual = JSON.stringify(result.output);
    const expected = JSON.stringify(output);
    if (actual !== expected) {
      problems.push(`expected output ${expected}, got ${actual}`);
    }
  }

  if (problems.length > 0) {
    failures += 1;
    console.error(`FAIL ${schema}: ${label}\n  ${problems.join('\n  ')}`);
  }
}

const total = PARAM_CASES.length + searchParamsCases.length;
if (failures > 0) {
  console.error(`\n${failures}/${total} param cases failed.`);
  process.exit(1);
}
console.log(`${total}/${total} param cases passed.`);
