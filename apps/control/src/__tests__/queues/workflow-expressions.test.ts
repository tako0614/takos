import { describe, expect, it } from 'vitest';
import { evaluateCondition, evaluateExpression } from '@/queues/workflow-expressions';
import type { ConditionContext, ExpressionContext } from '@/queues/workflow-types';

// ---------------------------------------------------------------------------
// evaluateCondition
// ---------------------------------------------------------------------------

describe('evaluateCondition', () => {
  describe('built-in functions', () => {
    it('always() returns true regardless of context', () => {
      expect(evaluateCondition('always()', {})).toBe(true);
      expect(evaluateCondition('always()', { job: { status: 'failure' } })).toBe(true);
    });

    it('cancelled() always returns false', () => {
      expect(evaluateCondition('cancelled()', {})).toBe(false);
      expect(evaluateCondition('cancelled()', { job: { status: 'cancelled' } })).toBe(false);
    });

    it('failure() returns true when job status is failure', () => {
      expect(evaluateCondition('failure()', { job: { status: 'failure' } })).toBe(true);
    });

    it('failure() returns false when job status is not failure', () => {
      expect(evaluateCondition('failure()', { job: { status: 'success' } })).toBe(false);
      expect(evaluateCondition('failure()', {})).toBe(false);
    });

    it('success() returns true when job status is success', () => {
      expect(evaluateCondition('success()', { job: { status: 'success' } })).toBe(true);
    });

    it('success() returns false when job status is not success', () => {
      expect(evaluateCondition('success()', { job: { status: 'failure' } })).toBe(false);
      expect(evaluateCondition('success()', {})).toBe(false);
    });
  });

  describe('expression interpolation ${{ ... }}', () => {
    it('evaluates steps.X.outputs.Y truthy', () => {
      const ctx: ConditionContext = {
        steps: { build: { result: 'ok' } },
      };
      expect(evaluateCondition('${{ steps.build.outputs.result }}', ctx)).toBe(true);
    });

    it('evaluates steps.X.outputs.Y falsy when missing', () => {
      const ctx: ConditionContext = {
        steps: {},
      };
      expect(evaluateCondition('${{ steps.build.outputs.result }}', ctx)).toBe(false);
    });

    it('evaluates steps.X.outputs.Y falsy when step missing', () => {
      expect(evaluateCondition('${{ steps.build.outputs.result }}', {})).toBe(false);
    });

    it('evaluates env.VAR truthy when set', () => {
      const ctx: ConditionContext = {
        env: { CI: 'true' },
      };
      expect(evaluateCondition('${{ env.CI }}', ctx)).toBe(true);
    });

    it('evaluates env.VAR falsy when not set', () => {
      const ctx: ConditionContext = {
        env: {},
      };
      expect(evaluateCondition('${{ env.MISSING }}', ctx)).toBe(false);
    });

    it('evaluates env.VAR falsy when env is undefined', () => {
      expect(evaluateCondition('${{ env.CI }}', {})).toBe(false);
    });

    it('evaluates inputs.X truthy when set', () => {
      const ctx: ConditionContext = {
        inputs: { deploy: true },
      };
      expect(evaluateCondition('${{ inputs.deploy }}', ctx)).toBe(true);
    });

    it('evaluates inputs.X falsy when not set', () => {
      expect(evaluateCondition('${{ inputs.deploy }}', { inputs: {} })).toBe(false);
    });

    it('evaluates github.event.inputs.X truthy when set', () => {
      const ctx: ConditionContext = {
        inputs: { version: '1.0.0' },
      };
      expect(evaluateCondition('${{ github.event.inputs.version }}', ctx)).toBe(true);
    });

    it('evaluates github.event.inputs.X falsy when not set', () => {
      expect(evaluateCondition('${{ github.event.inputs.version }}', {})).toBe(false);
    });
  });

  describe('edge cases', () => {
    it('returns false for unrecognized expressions', () => {
      expect(evaluateCondition('${{ unknown.property }}', {})).toBe(false);
    });

    it('returns false for non-expression strings', () => {
      expect(evaluateCondition('some random string', {})).toBe(false);
    });

    it('trims whitespace from expression', () => {
      expect(evaluateCondition('  always()  ', {})).toBe(true);
    });

    it('handles whitespace inside ${{ }}', () => {
      const ctx: ConditionContext = { env: { CI: 'true' } };
      expect(evaluateCondition('${{  env.CI  }}', ctx)).toBe(true);
    });

    it('evaluates env.VAR as falsy when value is empty string', () => {
      const ctx: ConditionContext = {
        env: { EMPTY: '' },
      };
      expect(evaluateCondition('${{ env.EMPTY }}', ctx)).toBe(false);
    });

    it('evaluates inputs.X as falsy when value is 0', () => {
      const ctx: ConditionContext = {
        inputs: { count: 0 },
      };
      expect(evaluateCondition('${{ inputs.count }}', ctx)).toBe(false);
    });

    it('evaluates inputs.X as falsy when value is false', () => {
      const ctx: ConditionContext = {
        inputs: { enabled: false },
      };
      expect(evaluateCondition('${{ inputs.enabled }}', ctx)).toBe(false);
    });
  });
});

// ---------------------------------------------------------------------------
// evaluateExpression
// ---------------------------------------------------------------------------

describe('evaluateExpression', () => {
  it('returns plain string unchanged when not an expression', () => {
    expect(evaluateExpression('hello world', {})).toBe('hello world');
  });

  it('resolves steps.X.outputs.Y', () => {
    const ctx: ExpressionContext = {
      steps: { build: { artifact: '/path/to/file' } },
    };
    expect(evaluateExpression('${{ steps.build.outputs.artifact }}', ctx)).toBe('/path/to/file');
  });

  it('returns null for missing step output', () => {
    const ctx: ExpressionContext = { steps: {} };
    expect(evaluateExpression('${{ steps.build.outputs.artifact }}', ctx)).toBeNull();
  });

  it('returns null when steps context is undefined', () => {
    expect(evaluateExpression('${{ steps.build.outputs.artifact }}', {})).toBeNull();
  });

  it('resolves inputs.X', () => {
    const ctx: ExpressionContext = { inputs: { version: '2.0' } };
    expect(evaluateExpression('${{ inputs.version }}', ctx)).toBe('2.0');
  });

  it('converts non-string inputs to string', () => {
    const ctx: ExpressionContext = { inputs: { count: 42 } };
    expect(evaluateExpression('${{ inputs.count }}', ctx)).toBe('42');
  });

  it('returns null for undefined inputs', () => {
    const ctx: ExpressionContext = { inputs: {} };
    expect(evaluateExpression('${{ inputs.missing }}', ctx)).toBeNull();
  });

  it('resolves github.event.inputs.X', () => {
    const ctx: ExpressionContext = { inputs: { environment: 'staging' } };
    expect(evaluateExpression('${{ github.event.inputs.environment }}', ctx)).toBe('staging');
  });

  it('returns null for unrecognized expression', () => {
    expect(evaluateExpression('${{ unknown.thing }}', {})).toBeNull();
  });

  it('returns null for null input value', () => {
    const ctx: ExpressionContext = { inputs: { val: null } };
    expect(evaluateExpression('${{ inputs.val }}', ctx)).toBeNull();
  });

  it('returns null for undefined input value', () => {
    const ctx: ExpressionContext = { inputs: { val: undefined } };
    expect(evaluateExpression('${{ inputs.val }}', ctx)).toBeNull();
  });

  it('converts boolean input to string', () => {
    const ctx: ExpressionContext = { inputs: { flag: true } };
    expect(evaluateExpression('${{ inputs.flag }}', ctx)).toBe('true');
  });

  it('returns empty string step output as falsy-ish but still string', () => {
    const ctx: ExpressionContext = {
      steps: { build: { result: '' } },
    };
    // Empty string returns null because of || null
    expect(evaluateExpression('${{ steps.build.outputs.result }}', ctx)).toBeNull();
  });
});
