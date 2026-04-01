import type { StepResult } from "../../workflow-models.ts";
import { buildStepsContext } from "../../scheduler/job-policy.ts";

import { assert, assertEquals } from "jsr:@std/assert";

function createStepResult(overrides: Partial<StepResult> = {}): StepResult {
  return {
    id: "step",
    status: "completed",
    outputs: {},
    ...overrides,
  };
}

Deno.test("steps-context helpers - builds context entries from step results and ignores anonymous steps", () => {
  const firstOutputs = { first: "1" };
  const secondOutputs = { second: "2" };
  const stepsContext = buildStepsContext([
    createStepResult({
      id: "build",
      outputs: firstOutputs,
      conclusion: "success",
    }),
    createStepResult({
      id: undefined,
      outputs: { ignored: "true" },
      conclusion: "failure",
    }),
    createStepResult({
      id: "build",
      outputs: secondOutputs,
      conclusion: "failure",
    }),
  ]);

  assertEquals(stepsContext, {
    build: {
      outputs: { second: "2" },
      outcome: "failure",
      conclusion: "failure",
    },
  });
  assert(stepsContext.build.outputs !== secondOutputs);
  assert(stepsContext.build.outputs !== firstOutputs);
});
