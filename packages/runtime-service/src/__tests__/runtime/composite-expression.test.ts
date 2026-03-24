import { describe, expect, it } from 'vitest';
import {
  resolveExpressionValue,
  interpolateString,
  evaluateCondition,
  normalizeInputValue,
  resolveEnv,
  resolveWith,
  resolveCompositeOutputs,
  type InterpolationContext,
} from '../../runtime/actions/composite-expression.js';

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

describe('resolveExpressionValue', () => {
  it('resolves "true" literal', () => {
    expect(resolveExpressionValue('true', makeContext())).toBe('true');
  });

  it('resolves "false" literal', () => {
    expect(resolveExpressionValue('false', makeContext())).toBe('false');
  });

  it('resolves inputs', () => {
    expect(resolveExpressionValue('inputs.name', makeContext())).toBe('world');
  });

  it('returns empty string for missing input', () => {
    expect(resolveExpressionValue('inputs.missing', makeContext())).toBe('');
  });

  it('resolves env values', () => {
    expect(resolveExpressionValue('env.CI', makeContext())).toBe('true');
  });

  it('returns empty string for missing env', () => {
    expect(resolveExpressionValue('env.MISSING', makeContext())).toBe('');
  });

  it('resolves step outputs', () => {
    expect(resolveExpressionValue('steps.build.outputs.output', makeContext())).toBe('built');
  });

  it('returns empty string for missing step', () => {
    expect(resolveExpressionValue('steps.missing.outputs.x', makeContext())).toBe('');
  });

  it('resolves github.workspace', () => {
    expect(resolveExpressionValue('github.workspace', makeContext())).toBe('/home/runner/work');
  });

  it('resolves github.ref', () => {
    expect(resolveExpressionValue('github.ref', makeContext())).toBe('refs/heads/main');
  });

  it('resolves github.sha', () => {
    expect(resolveExpressionValue('github.sha', makeContext())).toBe('abc123');
  });

  it('returns undefined for unknown github context key', () => {
    expect(resolveExpressionValue('github.unknown', makeContext())).toBeUndefined();
  });

  it('returns undefined for unknown expression prefix', () => {
    expect(resolveExpressionValue('unknown.value', makeContext())).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// interpolateString
// ---------------------------------------------------------------------------

describe('interpolateString', () => {
  it('interpolates input references', () => {
    expect(interpolateString('Hello ${{ inputs.name }}!', makeContext())).toBe('Hello world!');
  });

  it('interpolates env references', () => {
    expect(interpolateString('CI=${{ env.CI }}', makeContext())).toBe('CI=true');
  });

  it('replaces unknown expressions with empty string', () => {
    expect(interpolateString('${{ unknown.ref }}', makeContext())).toBe('');
  });

  it('handles multiple expressions', () => {
    expect(
      interpolateString('${{ inputs.name }} on ${{ github.ref }}', makeContext()),
    ).toBe('world on refs/heads/main');
  });

  it('returns original string with no expressions', () => {
    expect(interpolateString('no expressions here', makeContext())).toBe('no expressions here');
  });

  it('handles whitespace in expressions', () => {
    expect(interpolateString('${{  inputs.name  }}', makeContext())).toBe('world');
  });

  it('handles step output references', () => {
    expect(
      interpolateString('result=${{ steps.build.outputs.output }}', makeContext()),
    ).toBe('result=built');
  });
});

// ---------------------------------------------------------------------------
// evaluateCondition
// ---------------------------------------------------------------------------

describe('evaluateCondition', () => {
  it('returns true for empty condition', () => {
    expect(evaluateCondition('', makeContext())).toBe(true);
  });

  it('evaluates always() as true', () => {
    expect(evaluateCondition('always()', makeContext())).toBe(true);
  });

  it('evaluates cancelled() as false', () => {
    expect(evaluateCondition('cancelled()', makeContext())).toBe(false);
  });

  it('evaluates success() as true when jobStatus is success', () => {
    expect(evaluateCondition('success()', makeContext({ jobStatus: 'success' }))).toBe(true);
  });

  it('evaluates success() as false when jobStatus is failure', () => {
    expect(evaluateCondition('success()', makeContext({ jobStatus: 'failure' }))).toBe(false);
  });

  it('evaluates failure() as true when jobStatus is failure', () => {
    expect(evaluateCondition('failure()', makeContext({ jobStatus: 'failure' }))).toBe(true);
  });

  it('evaluates failure() as false when jobStatus is success', () => {
    expect(evaluateCondition('failure()', makeContext({ jobStatus: 'success' }))).toBe(false);
  });

  it('evaluates negation', () => {
    expect(evaluateCondition('!failure()', makeContext({ jobStatus: 'success' }))).toBe(true);
    expect(evaluateCondition('!failure()', makeContext({ jobStatus: 'failure' }))).toBe(false);
  });

  it('evaluates equality comparison', () => {
    expect(evaluateCondition("inputs.debug == 'true'", makeContext())).toBe(true);
    expect(evaluateCondition("inputs.debug == 'false'", makeContext())).toBe(false);
  });

  it('evaluates inequality comparison', () => {
    expect(evaluateCondition("inputs.debug != 'false'", makeContext())).toBe(true);
    expect(evaluateCondition("inputs.debug != 'true'", makeContext())).toBe(false);
  });

  it('strips ${{ }} wrapper from condition', () => {
    expect(evaluateCondition('${{ always() }}', makeContext())).toBe(true);
  });

  it('evaluates truthy expression value', () => {
    expect(evaluateCondition('inputs.name', makeContext())).toBe(true);
  });

  it('evaluates falsy expression value', () => {
    expect(evaluateCondition('inputs.missing', makeContext())).toBe(false);
  });

  it('handles comparison with double quotes', () => {
    expect(evaluateCondition('inputs.name == "world"', makeContext())).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// normalizeInputValue
// ---------------------------------------------------------------------------

describe('normalizeInputValue', () => {
  it('converts null to empty string', () => {
    expect(normalizeInputValue(null)).toBe('');
  });

  it('converts undefined to empty string', () => {
    expect(normalizeInputValue(undefined)).toBe('');
  });

  it('converts true to "true"', () => {
    expect(normalizeInputValue(true)).toBe('true');
  });

  it('converts false to "false"', () => {
    expect(normalizeInputValue(false)).toBe('false');
  });

  it('converts number to string', () => {
    expect(normalizeInputValue(42)).toBe('42');
  });

  it('passes string through', () => {
    expect(normalizeInputValue('hello')).toBe('hello');
  });
});

// ---------------------------------------------------------------------------
// resolveEnv
// ---------------------------------------------------------------------------

describe('resolveEnv', () => {
  it('returns empty object for undefined env', () => {
    expect(resolveEnv(undefined, makeContext())).toEqual({});
  });

  it('interpolates string values', () => {
    const result = resolveEnv({ MY_VAR: '${{ inputs.name }}' }, makeContext());
    expect(result).toEqual({ MY_VAR: 'world' });
  });

  it('passes non-expression strings through', () => {
    const result = resolveEnv({ STATIC: 'value' }, makeContext());
    expect(result).toEqual({ STATIC: 'value' });
  });
});

// ---------------------------------------------------------------------------
// resolveWith
// ---------------------------------------------------------------------------

describe('resolveWith', () => {
  it('returns empty object for undefined input', () => {
    expect(resolveWith(undefined, makeContext())).toEqual({});
  });

  it('interpolates string values', () => {
    const result = resolveWith({ name: '${{ inputs.name }}' }, makeContext());
    expect(result).toEqual({ name: 'world' });
  });

  it('passes non-string values through', () => {
    const result = resolveWith({ count: 42 as any }, makeContext());
    expect(result).toEqual({ count: 42 });
  });
});

// ---------------------------------------------------------------------------
// resolveCompositeOutputs
// ---------------------------------------------------------------------------

describe('resolveCompositeOutputs', () => {
  it('returns empty object for undefined outputs', () => {
    expect(resolveCompositeOutputs(undefined, makeContext())).toEqual({});
  });

  it('interpolates output values', () => {
    const outputs = {
      result: { value: '${{ steps.build.outputs.output }}' },
    };
    const result = resolveCompositeOutputs(outputs, makeContext());
    expect(result).toEqual({ result: 'built' });
  });

  it('skips outputs without value', () => {
    const outputs = {
      noValue: { description: 'No value set' },
    };
    const result = resolveCompositeOutputs(outputs, makeContext());
    expect(result).toEqual({});
  });

  it('handles multiple outputs', () => {
    const outputs = {
      a: { value: '${{ inputs.name }}' },
      b: { value: 'static' },
    };
    const result = resolveCompositeOutputs(outputs, makeContext());
    expect(result).toEqual({ a: 'world', b: 'static' });
  });
});
