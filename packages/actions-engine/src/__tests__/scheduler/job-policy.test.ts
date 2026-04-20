import type { JobResult, Step, StepResult } from "../../workflow-models.ts";
import { normalizeNeedsInput } from "../../scheduler/job.ts";
import {
  classifyStepControl,
  createCompletedJobResult,
  createInProgressJobResult,
  finalizeJobResult,
  getDependencySkipReason,
} from "../../scheduler/job-policy.ts";

import { assert, assertEquals } from "jsr:@std/assert";

Deno.test("job policy helpers - normalizes job needs definitions", () => {
  assertEquals(
    normalizeNeedsInput(
      {
        "runs-on": "ubuntu-latest",
        needs: "build",
        steps: [{ run: "echo test" }],
      }.needs,
    ),
    ["build"],
  );

  assertEquals(
    normalizeNeedsInput(
      {
        "runs-on": "ubuntu-latest",
        needs: ["build", "test"],
        steps: [{ run: "echo test" }],
      }.needs,
    ),
    ["build", "test"],
  );
});
Deno.test("job policy helpers - creates completed and in-progress job result shapes", () => {
  assertEquals(createCompletedJobResult("build", "Build", "skipped"), {
    id: "build",
    name: "Build",
    status: "completed",
    conclusion: "skipped",
    steps: [],
    outputs: {},
  });

  const inProgress = createInProgressJobResult("test", "Test");
  assertEquals(inProgress.id, "test");
  assertEquals(inProgress.name, "Test");
  assertEquals(inProgress.status, "in_progress");
  assertEquals(inProgress.outputs, {});
  assertEquals(inProgress.steps, []);
  assert(inProgress.startedAt instanceof Date);
});
Deno.test("job policy helpers - returns dependency skip reason for non-success dependency outcomes", () => {
  const results = new Map<string, JobResult>([
    [
      "setup",
      {
        id: "setup",
        status: "completed",
        conclusion: "failure",
        steps: [],
        outputs: {},
      },
    ],
  ]);

  assertEquals(
    getDependencySkipReason(["setup"], results),
    'Dependency "setup" failure',
  );

  results.set("setup", {
    id: "setup",
    status: "completed",
    conclusion: "cancelled",
    steps: [],
    outputs: {},
  });
  assertEquals(
    getDependencySkipReason(["setup"], results),
    'Dependency "setup" cancelled',
  );

  results.set("setup", {
    id: "setup",
    status: "completed",
    conclusion: "skipped",
    steps: [],
    outputs: {},
  });
  assertEquals(
    getDependencySkipReason(["setup"], results),
    'Dependency "setup" skipped',
  );

  results.set("setup", {
    id: "setup",
    status: "completed",
    steps: [],
    outputs: {},
  });
  assertEquals(
    getDependencySkipReason(["setup"], results),
    'Dependency "setup" did not succeed',
  );
});
Deno.test("job policy helpers - returns null when dependencies are successful or missing", () => {
  const results = new Map<string, JobResult>([
    [
      "setup",
      {
        id: "setup",
        status: "completed",
        conclusion: "success",
        steps: [],
        outputs: {},
      },
    ],
  ]);

  assertEquals(getDependencySkipReason(["setup"], results), null);
  assertEquals(getDependencySkipReason(["unknown"], results), null);
});
Deno.test("job policy helpers - ignores continue-on-error for failure control", () => {
  const strictStep: Step = { run: "build" };
  const permissiveStep: Step = { run: "build", "continue-on-error": true };
  const failureResult: StepResult = {
    id: "build",
    status: "completed",
    conclusion: "failure",
    outputs: {},
  };
  const successResult: StepResult = {
    id: "build",
    status: "completed",
    conclusion: "success",
    outputs: {},
  };

  assertEquals(classifyStepControl(strictStep, successResult, true), {
    shouldStopJob: false,
    shouldMarkJobFailed: false,
    shouldCancelWorkflow: false,
  });
  assertEquals(classifyStepControl(permissiveStep, failureResult, true), {
    shouldStopJob: true,
    shouldMarkJobFailed: true,
    shouldCancelWorkflow: true,
  });
  assertEquals(classifyStepControl(strictStep, failureResult, false), {
    shouldStopJob: true,
    shouldMarkJobFailed: true,
    shouldCancelWorkflow: false,
  });
  assertEquals(classifyStepControl(strictStep, failureResult, true), {
    shouldStopJob: true,
    shouldMarkJobFailed: true,
    shouldCancelWorkflow: true,
  });
});
Deno.test("job policy helpers - finalizes job status/conclusion and aggregates outputs from named steps", () => {
  const result = createInProgressJobResult("build", "Build");
  result.steps = [
    {
      id: "compile",
      status: "completed",
      conclusion: "success",
      outputs: { artifact: "build.tar" },
    },
    {
      status: "completed",
      conclusion: "success",
      outputs: { ignored: "value" },
    },
    {
      id: "test",
      status: "completed",
      conclusion: "success",
      outputs: { report: "junit.xml" },
    },
  ];

  finalizeJobResult(result, { failed: false, cancelled: false });
  assertEquals(result.status, "completed");
  assertEquals(result.conclusion, "success");
  assert(result.completedAt instanceof Date);
  assertEquals(result.outputs, {
    artifact: "build.tar",
    report: "junit.xml",
  });

  finalizeJobResult(result, { failed: true, cancelled: false });
  assertEquals(result.conclusion, "failure");

  finalizeJobResult(result, { failed: true, cancelled: true });
  assertEquals(result.conclusion, "cancelled");
});
