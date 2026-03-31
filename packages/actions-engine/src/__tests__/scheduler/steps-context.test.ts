import type { StepResult } from '../../workflow-models.ts';
import {
  buildStepsContext,
} from '../../scheduler/job-policy.ts';

import { assertEquals, assertNotEquals } from 'jsr:@std/assert';

function createStepResult(overrides: Partial<StepResult> = {}): StepResult {
  return {
    id: 'step',
    status: 'completed',
    outputs: {},
    ...overrides,
  };
}


  Deno.test('steps-context helpers - builds context entries from step results and ignores anonymous steps', () => {
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

    assertEquals(stepsContext, {
      build: {
        outputs: { second: '2' },
        outcome: 'failure',
        conclusion: 'failure',
      },
    });
    assertNotEquals(stepsContext.build.outputs, secondOutputs);
    assertNotEquals(stepsContext.build.outputs, firstOutputs);
})