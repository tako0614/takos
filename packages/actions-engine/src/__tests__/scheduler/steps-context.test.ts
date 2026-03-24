import { describe, expect, it } from 'vitest';

import type { StepResult } from '../../types.js';
import {
  buildStepsContext,
} from '../../scheduler/job.js';

function createStepResult(overrides: Partial<StepResult> = {}): StepResult {
  return {
    id: 'step',
    status: 'completed',
    outputs: {},
    ...overrides,
  };
}

describe('steps-context helpers', () => {
  it('builds context entries from step results and ignores anonymous steps', () => {
    const firstOutputs = { first: '1' };
    const secondOutputs = { second: '2' };
    const stepsContext = buildStepsContext([
      createStepResult({
        id: 'build',
        outputs: firstOutputs,
        conclusion: 'success',
      }),
      createStepResult({
        id: undefined,
        outputs: { ignored: 'true' },
        conclusion: 'failure',
      }),
      createStepResult({
        id: 'build',
        outputs: secondOutputs,
        conclusion: 'failure',
      }),
    ]);

    expect(stepsContext).toEqual({
      build: {
        outputs: { second: '2' },
        outcome: 'failure',
        conclusion: 'failure',
      },
    });
    expect(stepsContext.build.outputs).not.toBe(secondOutputs);
    expect(stepsContext.build.outputs).not.toBe(firstOutputs);
  });
});
