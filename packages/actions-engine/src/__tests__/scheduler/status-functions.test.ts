import { assert, assertEquals } from "jsr:@std/assert";

import { createBaseContext } from "../../context.ts";
import { JobScheduler } from "../../scheduler/job.ts";
import type { Step, Workflow } from "../../workflow-models.ts";
import {
  type ShellExecutor,
  StepRunner,
} from "../../scheduler/step.ts";

Deno.test("job if: always() runs even when a dependency failed", async () => {
  const executor: ShellExecutor = async (command) => {
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
  assertEquals(results.build.conclusion, "failure");
  assertEquals(results.cleanup.conclusion, "success");
});

Deno.test("job if: failure() runs when a dependency failed", async () => {
  const executor: ShellExecutor = async (command) => {
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
  assertEquals(results.build.conclusion, "failure");
  assertEquals(results.notify.conclusion, "success");
});

Deno.test("job if: failure() is falsy when dependency succeeded", async () => {
  const executor: ShellExecutor = async () => ({
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
  assertEquals(results.build.conclusion, "success");
  assertEquals(results.notify.conclusion, "skipped");
});

Deno.test("step if: failure() runs cleanup step after a prior step failure", async () => {
  const observed: string[] = [];
  const executor: ShellExecutor = async (command) => {
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
  assertEquals(observed, ["fail", "cleanup"]);
  // job overall still failure because the first step failed without continue-on-error
  assertEquals(results.build.conclusion, "failure");
  assertEquals(results.build.steps[0].conclusion, "failure");
  assertEquals(results.build.steps[1].conclusion, "success");
});

Deno.test("step if: always() runs even after a prior step failure", async () => {
  const observed: string[] = [];
  const executor: ShellExecutor = async (command) => {
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
  assertEquals(observed, ["fail", "cleanup"]);
  assertEquals(results.build.steps[1].conclusion, "success");
});

Deno.test("step if: success() is false after a prior step failure", async () => {
  const observed: string[] = [];
  const executor: ShellExecutor = async (command) => {
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
  assertEquals(results.build.steps[0].conclusion, "failure");
  assertEquals(results.build.steps[1].conclusion, "skipped");
  assertEquals(results.build.steps[2].conclusion, "success");
  // success() should NOT have reached the shell executor
  assert(!observed.includes("should-skip"));
});

Deno.test("StepRunner runStep - honors metadata.jobStatus when evaluating failure()", async () => {
  const runner = new StepRunner({
    shellExecutor: async () => ({ exitCode: 0, stdout: "", stderr: "" }),
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
  assertEquals(resultSuccess.conclusion, "skipped");

  const resultFailure = await runner.runStep(step, context, {
    index: 0,
    jobStatus: "failure",
  });
  assertEquals(resultFailure.conclusion, "success");
});
