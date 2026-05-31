import { expect, test } from "bun:test";

import { createBaseContext } from "../../context.ts";
import { JobScheduler } from "../../scheduler/job.ts";
import type { Step, Workflow } from "../../workflow-models.ts";
import { type ShellExecutor, StepRunner } from "../../scheduler/step.ts";
import { shouldSuppressDependencySkip } from "../../scheduler/job-expansion.ts";

test("shouldSuppressDependencySkip - true only for real status-function calls", () => {
  expect(shouldSuppressDependencySkip("${{ always() }}")).toBeTruthy();
  expect(shouldSuppressDependencySkip("failure()")).toBeTruthy();
  expect(shouldSuppressDependencySkip("${{ cancelled() }}")).toBeTruthy();
  // wrapped / spaced call forms still detected
  expect(shouldSuppressDependencySkip("${{ always () }}")).toBeTruthy();
});

test("shouldSuppressDependencySkip - ignores status names inside string literals", () => {
  // These embed `always(` / `failure(` only inside string literals or as a
  // bare identifier (no call), so they must NOT suppress dependency skip.
  expect(shouldSuppressDependencySkip("env.MSG == 'always('")).toBeFalsy();
  expect(shouldSuppressDependencySkip("contains(steps.x.outputs.log, 'failure(')")).toBeFalsy();
  expect(shouldSuppressDependencySkip("${{ env.cancelled }}")).toBeFalsy();
  expect(shouldSuppressDependencySkip(undefined)).toBeFalsy();
  expect(shouldSuppressDependencySkip("")).toBeFalsy();
});

test("job if: always() runs even when a dependency failed", async () => {
  const executor: ShellExecutor = async (command) => {
    await Promise.resolve();
    if (command === "fail") {
      return { exitCode: 1, stdout: "", stderr: "forced failure" };
    }
    return { exitCode: 0, stdout: "", stderr: "" };
  };

  const workflow: Workflow = {
    name: "job-always-after-failure",
    on: "push",
    jobs: {
      build: {
        "runs-on": "ubuntu-latest",
        steps: [{ run: "fail" }],
      },
      cleanup: {
        "runs-on": "ubuntu-latest",
        needs: "build",
        if: "${{ always() }}",
        steps: [{ run: "echo cleanup" }],
      },
    },
  };

  const scheduler = new JobScheduler(workflow, {
    failFast: false,
    stepRunner: { shellExecutor: executor },
  });

  const results = await scheduler.run(createBaseContext());
  expect(results.build.conclusion).toEqual("failure");
  expect(results.cleanup.conclusion).toEqual("success");
});

test("job if: failure() is not dependency-aware", async () => {
  const executor: ShellExecutor = async (command) => {
    await Promise.resolve();
    if (command === "fail") {
      return { exitCode: 1, stdout: "", stderr: "forced failure" };
    }
    return { exitCode: 0, stdout: "", stderr: "" };
  };

  const workflow: Workflow = {
    name: "job-failure-hook",
    on: "push",
    jobs: {
      build: {
        "runs-on": "ubuntu-latest",
        steps: [{ run: "fail" }],
      },
      notify: {
        "runs-on": "ubuntu-latest",
        needs: "build",
        if: "${{ failure() }}",
        steps: [{ run: "echo notify" }],
      },
    },
  };

  const scheduler = new JobScheduler(workflow, {
    failFast: false,
    stepRunner: { shellExecutor: executor },
  });

  const results = await scheduler.run(createBaseContext());
  expect(results.build.conclusion).toEqual("failure");
  expect(results.notify.conclusion).toEqual("skipped");
});

test("job if: failure() is falsy when dependency succeeded", async () => {
  const executor: ShellExecutor = () =>
    Promise.resolve({
      exitCode: 0,
      stdout: "",
      stderr: "",
    });

  const workflow: Workflow = {
    name: "job-failure-hook-success",
    on: "push",
    jobs: {
      build: {
        "runs-on": "ubuntu-latest",
        steps: [{ run: "echo ok" }],
      },
      notify: {
        "runs-on": "ubuntu-latest",
        needs: "build",
        if: "${{ failure() }}",
        steps: [{ run: "echo notify" }],
      },
    },
  };

  const scheduler = new JobScheduler(workflow, {
    failFast: false,
    stepRunner: { shellExecutor: executor },
  });

  const results = await scheduler.run(createBaseContext());
  expect(results.build.conclusion).toEqual("success");
  expect(results.notify.conclusion).toEqual("skipped");
});

test("step if: failure() runs cleanup step after a prior step failure", async () => {
  const observed: string[] = [];
  const executor: ShellExecutor = async (command) => {
    await Promise.resolve();
    observed.push(command);
    if (command === "fail") {
      return { exitCode: 1, stdout: "", stderr: "forced failure" };
    }
    return { exitCode: 0, stdout: "", stderr: "" };
  };

  const workflow: Workflow = {
    name: "step-failure-cleanup",
    on: "push",
    jobs: {
      build: {
        "runs-on": "ubuntu-latest",
        steps: [
          { run: "fail" },
          { if: "${{ failure() }}", run: "cleanup" },
        ],
      },
    },
  };

  const scheduler = new JobScheduler(workflow, {
    failFast: false,
    stepRunner: { shellExecutor: executor },
  });

  const results = await scheduler.run(createBaseContext());
  expect(observed).toEqual(["fail", "cleanup"]);
  // job overall still failure because the first step failed without continue-on-error
  expect(results.build.conclusion).toEqual("failure");
  expect(results.build.steps[0].conclusion).toEqual("failure");
  expect(results.build.steps[1].conclusion).toEqual("success");
});

test("step if: always() runs even after a prior step failure", async () => {
  const observed: string[] = [];
  const executor: ShellExecutor = async (command) => {
    await Promise.resolve();
    observed.push(command);
    if (command === "fail") {
      return { exitCode: 1, stdout: "", stderr: "forced failure" };
    }
    return { exitCode: 0, stdout: "", stderr: "" };
  };

  const workflow: Workflow = {
    name: "step-always-cleanup",
    on: "push",
    jobs: {
      build: {
        "runs-on": "ubuntu-latest",
        steps: [
          { run: "fail" },
          { if: "${{ always() }}", run: "cleanup" },
        ],
      },
    },
  };

  const scheduler = new JobScheduler(workflow, {
    failFast: false,
    stepRunner: { shellExecutor: executor },
  });

  const results = await scheduler.run(createBaseContext());
  expect(observed).toEqual(["fail", "cleanup"]);
  expect(results.build.steps[1].conclusion).toEqual("success");
});

test("step if: success() is false after a prior step failure", async () => {
  const observed: string[] = [];
  const executor: ShellExecutor = async (command) => {
    await Promise.resolve();
    observed.push(command);
    if (command === "fail") {
      return { exitCode: 1, stdout: "", stderr: "forced failure" };
    }
    return { exitCode: 0, stdout: "", stderr: "" };
  };

  const workflow: Workflow = {
    name: "step-success-after-failure",
    on: "push",
    jobs: {
      build: {
        "runs-on": "ubuntu-latest",
        steps: [
          { run: "fail" },
          { if: "${{ success() }}", run: "should-skip" },
          { if: "${{ always() }}", run: "observe" },
        ],
      },
    },
  };

  const scheduler = new JobScheduler(workflow, {
    failFast: false,
    stepRunner: { shellExecutor: executor },
  });

  const results = await scheduler.run(createBaseContext());
  // First step failed, second step is skipped via success() == false,
  // third step runs due to always().
  expect(results.build.steps[0].conclusion).toEqual("failure");
  expect(results.build.steps[1].conclusion).toEqual("skipped");
  expect(results.build.steps[2].conclusion).toEqual("success");
  // success() should NOT have reached the shell executor
  expect(!observed.includes("should-skip")).toBeTruthy();
});

test("StepRunner runStep - honors metadata.jobStatus when evaluating failure()", async () => {
  const runner = new StepRunner({
    shellExecutor: () =>
      Promise.resolve({ exitCode: 0, stdout: "", stderr: "" }),
  });

  const context = createBaseContext();
  const step: Step = {
    id: "only-if-failed",
    if: "${{ failure() }}",
    run: "echo cleanup",
  };

  const resultSuccess = await runner.runStep(step, context, {
    index: 0,
    jobStatus: "success",
  });
  expect(resultSuccess.conclusion).toEqual("skipped");

  const resultFailure = await runner.runStep(step, context, {
    index: 0,
    jobStatus: "failure",
  });
  expect(resultFailure.conclusion).toEqual("success");
});
