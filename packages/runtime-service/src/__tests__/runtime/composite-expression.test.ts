import {
  resolveExpressionValue,
  interpolateString,
  evaluateCondition,
  normalizeInputValue,
  resolveEnv,
  resolveWith,
  resolveCompositeOutputs,
  type InterpolationContext,
} from '../../runtime/actions/composite-expression.ts';

import { assertEquals } from 'jsr:@std/assert';

function makeContext(overrides: Partial<InterpolationContext> = {}): InterpolationContext {
  return {
    inputs: { name: 'world', debug: 'true' },
    env: {
      CI: 'true',
      GITHUB_WORKSPACE: '/home/runner/work',
      GITHUB_REF: 'refs/heads/main',
      GITHUB_SHA: 'abc123',
    },
    steps: {
      build: { status: 'success', output: 'built' },
    },
    jobStatus: 'success',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// resolveExpressionValue
// ---------------------------------------------------------------------------


  Deno.test('resolveExpressionValue - resolves "true" literal', () => {
  assertEquals(resolveExpressionValue('true', makeContext()), 'true');
})
  Deno.test('resolveExpressionValue - resolves "false" literal', () => {
  assertEquals(resolveExpressionValue('false', makeContext()), 'false');
})
  Deno.test('resolveExpressionValue - resolves inputs', () => {
  assertEquals(resolveExpressionValue('inputs.name', makeContext()), 'world');
})
  Deno.test('resolveExpressionValue - returns empty string for missing input', () => {
  assertEquals(resolveExpressionValue('inputs.missing', makeContext()), '');
})
  Deno.test('resolveExpressionValue - resolves env values', () => {
  assertEquals(resolveExpressionValue('env.CI', makeContext()), 'true');
})
  Deno.test('resolveExpressionValue - returns empty string for missing env', () => {
  assertEquals(resolveExpressionValue('env.MISSING', makeContext()), '');
})
  Deno.test('resolveExpressionValue - resolves step outputs', () => {
  assertEquals(resolveExpressionValue('steps.build.outputs.output', makeContext()), 'built');
})
  Deno.test('resolveExpressionValue - returns empty string for missing step', () => {
  assertEquals(resolveExpressionValue('steps.missing.outputs.x', makeContext()), '');
})
  Deno.test('resolveExpressionValue - resolves github.workspace', () => {
  assertEquals(resolveExpressionValue('github.workspace', makeContext()), '/home/runner/work');
})
  Deno.test('resolveExpressionValue - resolves github.ref', () => {
  assertEquals(resolveExpressionValue('github.ref', makeContext()), 'refs/heads/main');
})
  Deno.test('resolveExpressionValue - resolves github.sha', () => {
  assertEquals(resolveExpressionValue('github.sha', makeContext()), 'abc123');
})
  Deno.test('resolveExpressionValue - returns undefined for unknown github context key', () => {
  assertEquals(resolveExpressionValue('github.unknown', makeContext()), undefined);
})
  Deno.test('resolveExpressionValue - returns undefined for unknown expression prefix', () => {
  assertEquals(resolveExpressionValue('unknown.value', makeContext()), undefined);
})
// ---------------------------------------------------------------------------
// interpolateString
// ---------------------------------------------------------------------------


  Deno.test('interpolateString - interpolates input references', () => {
  assertEquals(interpolateString('Hello ${{ inputs.name }}!', makeContext()), 'Hello world!');
})
  Deno.test('interpolateString - interpolates env references', () => {
  assertEquals(interpolateString('CI=${{ env.CI }}', makeContext()), 'CI=true');
})
  Deno.test('interpolateString - replaces unknown expressions with empty string', () => {
  assertEquals(interpolateString('${{ unknown.ref }}', makeContext()), '');
})
  Deno.test('interpolateString - handles multiple expressions', () => {
  assertEquals(
      interpolateString('${{ inputs.name }} on ${{ github.ref }}', makeContext()),
    , 'world on refs/heads/main');
})
  Deno.test('interpolateString - returns original string with no expressions', () => {
  assertEquals(interpolateString('no expressions here', makeContext()), 'no expressions here');
})
  Deno.test('interpolateString - handles whitespace in expressions', () => {
  assertEquals(interpolateString('${{  inputs.name  }}', makeContext()), 'world');
})
  Deno.test('interpolateString - handles step output references', () => {
  assertEquals(
      interpolateString('result=${{ steps.build.outputs.output }}', makeContext()),
    , 'result=built');
})
// ---------------------------------------------------------------------------
// evaluateCondition
// ---------------------------------------------------------------------------


  Deno.test('evaluateCondition - returns true for empty condition', () => {
  assertEquals(evaluateCondition('', makeContext()), true);
})
  Deno.test('evaluateCondition - evaluates always() as true', () => {
  assertEquals(evaluateCondition('always()', makeContext()), true);
})
  Deno.test('evaluateCondition - evaluates cancelled() as false', () => {
  assertEquals(evaluateCondition('cancelled()', makeContext()), false);
})
  Deno.test('evaluateCondition - evaluates success() as true when jobStatus is success', () => {
  assertEquals(evaluateCondition('success()', makeContext({ jobStatus: 'success' })), true);
})
  Deno.test('evaluateCondition - evaluates success() as false when jobStatus is failure', () => {
  assertEquals(evaluateCondition('success()', makeContext({ jobStatus: 'failure' })), false);
})
  Deno.test('evaluateCondition - evaluates failure() as true when jobStatus is failure', () => {
  assertEquals(evaluateCondition('failure()', makeContext({ jobStatus: 'failure' })), true);
})
  Deno.test('evaluateCondition - evaluates failure() as false when jobStatus is success', () => {
  assertEquals(evaluateCondition('failure()', makeContext({ jobStatus: 'success' })), false);
})
  Deno.test('evaluateCondition - evaluates negation', () => {
  assertEquals(evaluateCondition('!failure()', makeContext({ jobStatus: 'success' })), true);
    assertEquals(evaluateCondition('!failure()', makeContext({ jobStatus: 'failure' })), false);
})
  Deno.test('evaluateCondition - evaluates equality comparison', () => {
  assertEquals(evaluateCondition("inputs.debug == 'true'", makeContext()), true);
    assertEquals(evaluateCondition("inputs.debug == 'false'", makeContext()), false);
})
  Deno.test('evaluateCondition - evaluates inequality comparison', () => {
  assertEquals(evaluateCondition("inputs.debug != 'false'", makeContext()), true);
    assertEquals(evaluateCondition("inputs.debug != 'true'", makeContext()), false);
})
  Deno.test('evaluateCondition - strips ${{ }} wrapper from condition', () => {
  assertEquals(evaluateCondition('${{ always() }}', makeContext()), true);
})
  Deno.test('evaluateCondition - evaluates truthy expression value', () => {
  assertEquals(evaluateCondition('inputs.name', makeContext()), true);
})
  Deno.test('evaluateCondition - evaluates falsy expression value', () => {
  assertEquals(evaluateCondition('inputs.missing', makeContext()), false);
})
  Deno.test('evaluateCondition - handles comparison with double quotes', () => {
  assertEquals(evaluateCondition('inputs.name == "world"', makeContext()), true);
})
// ---------------------------------------------------------------------------
// normalizeInputValue
// ---------------------------------------------------------------------------


  Deno.test('normalizeInputValue - converts null to empty string', () => {
  assertEquals(normalizeInputValue(null), '');
})
  Deno.test('normalizeInputValue - converts undefined to empty string', () => {
  assertEquals(normalizeInputValue(undefined), '');
})
  Deno.test('normalizeInputValue - converts true to "true"', () => {
  assertEquals(normalizeInputValue(true), 'true');
})
  Deno.test('normalizeInputValue - converts false to "false"', () => {
  assertEquals(normalizeInputValue(false), 'false');
})
  Deno.test('normalizeInputValue - converts number to string', () => {
  assertEquals(normalizeInputValue(42), '42');
})
  Deno.test('normalizeInputValue - passes string through', () => {
  assertEquals(normalizeInputValue('hello'), 'hello');
})
// ---------------------------------------------------------------------------
// resolveEnv
// ---------------------------------------------------------------------------


  Deno.test('resolveEnv - returns empty object for undefined env', () => {
  assertEquals(resolveEnv(undefined, makeContext()), {});
})
  Deno.test('resolveEnv - interpolates string values', () => {
  const result = resolveEnv({ MY_VAR: '${{ inputs.name }}' }, makeContext());
    assertEquals(result, { MY_VAR: 'world' });
})
  Deno.test('resolveEnv - passes non-expression strings through', () => {
  const result = resolveEnv({ STATIC: 'value' }, makeContext());
    assertEquals(result, { STATIC: 'value' });
})
// ---------------------------------------------------------------------------
// resolveWith
// ---------------------------------------------------------------------------


  Deno.test('resolveWith - returns empty object for undefined input', () => {
  assertEquals(resolveWith(undefined, makeContext()), {});
})
  Deno.test('resolveWith - interpolates string values', () => {
  const result = resolveWith({ name: '${{ inputs.name }}' }, makeContext());
    assertEquals(result, { name: 'world' });
})
  Deno.test('resolveWith - passes non-string values through', () => {
  const result = resolveWith({ count: 42 as any }, makeContext());
    assertEquals(result, { count: 42 });
})
// ---------------------------------------------------------------------------
// resolveCompositeOutputs
// ---------------------------------------------------------------------------


  Deno.test('resolveCompositeOutputs - returns empty object for undefined outputs', () => {
  assertEquals(resolveCompositeOutputs(undefined, makeContext()), {});
})
  Deno.test('resolveCompositeOutputs - interpolates output values', () => {
  const outputs = {
      result: { value: '${{ steps.build.outputs.output }}' },
    };
    const result = resolveCompositeOutputs(outputs, makeContext());
    assertEquals(result, { result: 'built' });
})
  Deno.test('resolveCompositeOutputs - skips outputs without value', () => {
  const outputs = {
      noValue: { description: 'No value set' },
    };
    const result = resolveCompositeOutputs(outputs, makeContext());
    assertEquals(result, {});
})
  Deno.test('resolveCompositeOutputs - handles multiple outputs', () => {
  const outputs = {
      a: { value: '${{ inputs.name }}' },
      b: { value: 'static' },
    };
    const result = resolveCompositeOutputs(outputs, makeContext());
    assertEquals(result, { a: 'world', b: 'static' });
})