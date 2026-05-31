import { expect, test } from "bun:test";
import type { StepResult } from "../../workflow-models.ts";
import { buildStepsContext } from "../../scheduler/job-policy.ts";

function createStepResult(overrides: Partial<StepResult> = {}): StepResult {
  return {
    id: "step",
    status: "completed",
    outputs: {},
    ...overrides,
  };
}

test("steps-context helpers - builds context entries from step results and ignores anonymous steps", () => {
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

  expect(stepsContext).toEqual({
    build: {
      outputs: { second: "2" },
      outcome: "failure",
      conclusion: "failure",
    },
  });
  expect(stepsContext.build.outputs !== secondOutputs).toBeTruthy();
  expect(stepsContext.build.outputs !== firstOutputs).toBeTruthy();
});
test("steps-context helpers - mirrors conclusion into outcome", () => {
  const stepsContext = buildStepsContext([
    createStepResult({
      id: "flaky",
      outputs: {},
      outcome: "failure",
      conclusion: "success",
    }),
  ]);

  expect(stepsContext.flaky.outcome).toEqual("success");
  expect(stepsContext.flaky.conclusion).toEqual("success");
});
