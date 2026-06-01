import { expect, test } from "bun:test";
import { createBaseContext } from "../../context.ts";
import type {
  ExecutionContext,
  JobResult,
  Step,
  StepResult,
  Workflow,
} from "../../workflow-models.ts";
import { JobScheduler } from "../../scheduler/job.ts";
import {
  type ShellExecutor,
  type StepRunMetadata,
  StepRunner,
} from "../../scheduler/step.ts";

import { assert, assertEquals, assertRejects } from "@takos/test/assert";

function expectStoredAndEventResultSnapshots(
  eventResult: JobResult | undefined,
  storedResultAtEmit: JobResult | undefined,
  runResult: JobResult,
): void {
  expect(eventResult !== undefined).toBeTruthy();
  expect(storedResultAtEmit !== undefined).toBeTruthy();
  expect(storedResultAtEmit !== eventResult).toBeTruthy();
  expect(storedResultAtEmit !== runResult).toBeTruthy();
  expect(eventResult !== runResult).toBeTruthy();
  expect(storedResultAtEmit).toEqual(runResult);
  expect(eventResult).toEqual(runResult);
}

test("JobScheduler fail-fast behavior - stops later phases and preserves cancelled results when fail-fast is enabled", async () => {
  const executedCommands: string[] = [];
  const shellExecutor: ShellExecutor = async (command) => {
    await Promise.resolve();
    executedCommands.push(command);

    if (command === "fail") {
      return {
        exitCode: 1,
        stdout: "",
        stderr: "forced failure",
      };
    }

    return {
      exitCode: 0,
      stdout: "",
      stderr: "",
    };
  };

  const workflow: Workflow = {
    name: "fail-fast-workflow",
    on: "push",
    jobs: {
      setup: {
        "runs-on": "ubuntu-latest",
        steps: [{ run: "setup" }],
      },
      fail: {
        "runs-on": "ubuntu-latest",
        steps: [{ run: "fail" }],
      },
      next: {
        "runs-on": "ubuntu-latest",
        needs: "setup",
        steps: [{ run: "next" }],
      },
    },
  };

  const scheduler = new JobScheduler(workflow, {
    failFast: true,
    stepRunner: { shellExecutor },
  });

  const startedPhases: number[] = [];
  const completedJobs: string[] = [];
  scheduler.on((event) => {
    if (event.type === "phase:start") {
      startedPhases.push(event.phase);
    }
    if (event.type === "job:complete") {
      completedJobs.push(event.jobId);
    }
  });

  const results = await scheduler.run(createBaseContext());

  expect(executedCommands.includes("setup")).toBeTruthy();
  expect(executedCommands.includes("fail")).toBeTruthy();
  expect(!executedCommands.includes("next")).toBeTruthy();
  expect(startedPhases).toEqual([0]);
  expect(results.fail.conclusion).toEqual("failure");
  expect(results.next.conclusion).toEqual("cancelled");
  expect(completedJobs.sort()).toEqual(["fail", "next", "setup"]);
  expect(scheduler.getConclusion()).toEqual("failure");
});
test("JobScheduler fail-fast behavior - stops remaining steps after a failed step even when fail-fast is disabled", async () => {
  const executedCommands: string[] = [];
  const shellExecutor: ShellExecutor = async (command) => {
    await Promise.resolve();
    executedCommands.push(command);

    if (command === "fail") {
      return {
        exitCode: 1,
        stdout: "",
        stderr: "forced failure",
      };
    }

    return {
      exitCode: 0,
      stdout: "",
      stderr: "",
    };
  };

  const workflow: Workflow = {
    name: "step-failure-stops-job",
    on: "push",
    jobs: {
      build: {
        "runs-on": "ubuntu-latest",
        steps: [{ run: "fail" }, { run: "after-fail" }],
      },
    },
  };

  const scheduler = new JobScheduler(workflow, {
    failFast: false,
    stepRunner: { shellExecutor },
  });

  const results = await scheduler.run(createBaseContext());

  // 後続ステップは実行されないが、`skipped` としてステップ履歴へ記録される
  expect(executedCommands).toEqual(["fail"]);
  expect(results.build.steps.length).toEqual(2);
  expect(results.build.steps[0].conclusion).toEqual("failure");
  expect(results.build.steps[1].conclusion).toEqual("skipped");
  expect(results.build.conclusion).toEqual("failure");
});
test("JobScheduler fail-fast behavior - continues independent jobs and skips only dependency-failed jobs when fail-fast is disabled", async () => {
  const executedCommands: string[] = [];
  const shellExecutor: ShellExecutor = async (command) => {
    await Promise.resolve();
    executedCommands.push(command);

    if (command === "build") {
      return {
        exitCode: 1,
        stdout: "",
        stderr: "forced build failure",
      };
    }

    return {
      exitCode: 0,
      stdout: "",
      stderr: "",
    };
  };

  const workflow: Workflow = {
    name: "fail-fast-disabled-dependency-skip-scope",
    on: "push",
    jobs: {
      build: {
        "runs-on": "ubuntu-latest",
        steps: [{ run: "build" }],
      },
      lint: {
        "runs-on": "ubuntu-latest",
        steps: [{ run: "lint" }],
      },
      deploy: {
        "runs-on": "ubuntu-latest",
        needs: "build",
        steps: [{ run: "deploy" }],
      },
    },
  };

  const scheduler = new JobScheduler(workflow, {
    failFast: false,
    stepRunner: { shellExecutor },
  });

  const results = await scheduler.run(createBaseContext());

  expect(results.build.conclusion).toEqual("failure");
  expect(results.lint.conclusion).toEqual("success");
  expect(results.deploy.conclusion).toEqual("skipped");
  expect(executedCommands.includes("build")).toBeTruthy();
  expect(executedCommands.includes("lint")).toBeTruthy();
  expect(!executedCommands.includes("deploy")).toBeTruthy();
});
test("JobScheduler fail-fast behavior - treats continue-on-error as unsupported", async () => {
  const executedCommands: string[] = [];
  const shellExecutor: ShellExecutor = async (command) => {
    await Promise.resolve();
    executedCommands.push(command);

    if (command === "allowed-fail") {
      return {
        exitCode: 1,
        stdout: "",
        stderr: "allowed failure",
      };
    }

    return {
      exitCode: 0,
      stdout: "",
      stderr: "",
    };
  };

  const workflow: Workflow = {
    name: "continue-on-error-job",
    on: "push",
    jobs: {
      build: {
        "runs-on": "ubuntu-latest",
        steps: [
          { run: "allowed-fail", "continue-on-error": true },
          { run: "after-continue" },
        ],
      },
    },
  };

  const scheduler = new JobScheduler(workflow, {
    failFast: false,
    stepRunner: { shellExecutor },
  });

  const results = await scheduler.run(createBaseContext());

  expect(executedCommands).toEqual(["allowed-fail"]);
  expect(results.build.steps.length).toEqual(2);
  expect(results.build.steps[1].conclusion).toEqual("skipped");
  expect(results.build.conclusion).toEqual("failure");
});
test("JobScheduler fail-fast behavior - propagates fail-fast cancellation within phase chunks", async () => {
  const executedCommands: string[] = [];
  const shellExecutor: ShellExecutor = async (command) => {
    executedCommands.push(command);

    if (command === "work-1") {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }

    if (command === "fail") {
      return {
        exitCode: 1,
        stdout: "",
        stderr: "forced failure",
      };
    }

    return {
      exitCode: 0,
      stdout: "",
      stderr: "",
    };
  };

  const workflow: Workflow = {
    name: "chunk-cancellation",
    on: "push",
    jobs: {
      "a-fail": {
        "runs-on": "ubuntu-latest",
        steps: [{ run: "fail" }],
      },
      "b-work": {
        "runs-on": "ubuntu-latest",
        steps: [{ run: "work-1" }, { run: "work-2" }],
      },
      "c-later": {
        "runs-on": "ubuntu-latest",
        steps: [{ run: "later" }],
      },
    },
  };

  const scheduler = new JobScheduler(workflow, {
    failFast: true,
    maxParallel: 2,
    stepRunner: { shellExecutor },
  });

  const results = await scheduler.run(createBaseContext());

  expect(executedCommands.includes("fail")).toBeTruthy();
  expect(executedCommands.includes("work-1")).toBeTruthy();
  expect(!executedCommands.includes("work-2")).toBeTruthy();
  expect(!executedCommands.includes("later")).toBeTruthy();
  expect(results["a-fail"].conclusion).toEqual("failure");
  expect(results["b-work"].conclusion).toEqual("cancelled");
  expect(results["c-later"].conclusion).toEqual("cancelled");
});
test("JobScheduler fail-fast behavior - does not execute a job that is already marked as cancelled", async () => {
  const shellExecutor: ShellExecutor = async () => {
    await Promise.resolve();
    throw new Error("shell executor should not be called");
  };

  const workflow: Workflow = {
    name: "cancelled-job-guard",
    on: "push",
    jobs: {
      guarded: {
        name: "guarded",
        "runs-on": "ubuntu-latest",
        steps: [{ run: "should-not-run" }],
      },
    },
  };

  const scheduler = new JobScheduler(workflow, {
    stepRunner: { shellExecutor },
  });

  const cancelledResult: JobResult = {
    id: "guarded",
    name: "guarded",
    status: "completed",
    conclusion: "cancelled",
    steps: [],
    outputs: {},
  };

  const internalScheduler = scheduler as unknown as {
    results: Map<string, JobResult>;
    runJob: (jobId: string, context: ExecutionContext) => Promise<JobResult>;
  };

  internalScheduler.results.set("guarded", cancelledResult);

  const result = await internalScheduler.runJob("guarded", createBaseContext());

  expect(result !== cancelledResult).toBeTruthy();
  expect(result).toEqual(cancelledResult);
});
test("JobScheduler fail-fast behavior - prioritizes cancellation over condition-based skipping when scheduler is cancelled", async () => {
  const shellExecutor: ShellExecutor = async () => {
    await Promise.resolve();
    throw new Error("shell executor should not be called");
  };

  const workflow: Workflow = {
    name: "cancel-priority-over-skip",
    on: "push",
    jobs: {
      guarded: {
        name: "guarded",
        if: "${{ false }}",
        "runs-on": "ubuntu-latest",
        steps: [{ run: "should-not-run" }],
      },
    },
  };

  const scheduler = new JobScheduler(workflow, {
    stepRunner: { shellExecutor },
  });

  scheduler.cancel();

  const internalScheduler = scheduler as unknown as {
    runJob: (jobId: string, context: ExecutionContext) => Promise<JobResult>;
  };

  const result = await internalScheduler.runJob("guarded", createBaseContext());
  expect(result.conclusion).toEqual("cancelled");
  expect(result.status).toEqual("completed");
});
test("JobScheduler fail-fast behavior - stores a finalized result before emitting job:complete", async () => {
  const workflow: Workflow = {
    name: "complete-event-observation",
    on: "push",
    jobs: {
      build: {
        "runs-on": "ubuntu-latest",
        steps: [{ id: "compile", run: "compile" }],
      },
    },
  };

  class OutputStepRunner extends StepRunner {
    override async runStep(step: Step): Promise<StepResult> {
      await Promise.resolve();
      return {
        id: step.id,
        name: step.name,
        status: "completed",
        conclusion: "success",
        outputs: { artifact: "build.tar" },
        startedAt: new Date(),
        completedAt: new Date(),
      };
    }
  }

  const scheduler = new JobScheduler(workflow);
  const internalScheduler = scheduler as unknown as { stepRunner: StepRunner };
  internalScheduler.stepRunner = new OutputStepRunner();

  let completeEventCount = 0;
  let emittedResult: JobResult | undefined;
  let storedResultAtEmit: JobResult | undefined;
  scheduler.on((event) => {
    if (event.type !== "job:complete") {
      return;
    }

    completeEventCount += 1;
    emittedResult = event.result;
    storedResultAtEmit = scheduler.getResults()[event.jobId];
  });

  const results = await scheduler.run(createBaseContext());

  expect(completeEventCount).toEqual(1);
  expectStoredAndEventResultSnapshots(
    emittedResult,
    storedResultAtEmit,
    results.build,
  );
  expect(storedResultAtEmit?.status).toEqual("completed");
  expect(storedResultAtEmit?.conclusion).toEqual("success");
  expect(storedResultAtEmit?.completedAt instanceof Date).toBeTruthy();
  expect(storedResultAtEmit?.outputs).toEqual({ artifact: "build.tar" });
});
test("JobScheduler fail-fast behavior - keeps job:skip emit and stored skipped result in sync", async () => {
  const shellExecutor: ShellExecutor = async () => {
    await Promise.resolve();
    throw new Error("shell executor should not be called");
  };

  const workflow: Workflow = {
    name: "skip-event-observation",
    on: "push",
    jobs: {
      guarded: {
        if: "${{ false }}",
        "runs-on": "ubuntu-latest",
        steps: [{ run: "should-not-run" }],
      },
    },
  };

  const scheduler = new JobScheduler(workflow, {
    stepRunner: { shellExecutor },
  });

  const jobEvents: string[] = [];
  let skipReason: string | undefined;
  let skipEventResult: JobResult | undefined;
  let storedResultAtSkipEmit: JobResult | undefined;
  scheduler.on((event) => {
    if (
      event.type === "job:start" ||
      event.type === "job:skip" ||
      event.type === "job:complete"
    ) {
      jobEvents.push(event.type);
    }

    if (event.type !== "job:skip") {
      return;
    }

    skipReason = event.reason;
    skipEventResult = event.result;
    storedResultAtSkipEmit = scheduler.getResults()[event.jobId];
  });

  const results = await scheduler.run(createBaseContext());

  expect(jobEvents).toEqual(["job:skip", "job:complete"]);
  expect(skipReason).toEqual("Condition not met");
  expectStoredAndEventResultSnapshots(
    skipEventResult,
    storedResultAtSkipEmit,
    results.guarded,
  );
  expect(storedResultAtSkipEmit?.status).toEqual("completed");
  expect(storedResultAtSkipEmit?.conclusion).toEqual("skipped");
});
test("JobScheduler fail-fast behavior - isolates job:complete and stored results from job:skip event mutations", async () => {
  const shellExecutor: ShellExecutor = async () => {
    await Promise.resolve();
    throw new Error("shell executor should not be called");
  };

  const workflow: Workflow = {
    name: "skip-event-payload-isolation",
    on: "push",
    jobs: {
      guarded: {
        if: "${{ false }}",
        "runs-on": "ubuntu-latest",
        steps: [{ run: "should-not-run" }],
      },
    },
  };

  const scheduler = new JobScheduler(workflow, {
    stepRunner: { shellExecutor },
  });

  let completeEventResult: JobResult | undefined;
  scheduler.on((event) => {
    if (event.type === "job:skip") {
      event.result.outputs.leaked = "mutated-by-skip-listener";
      event.result.steps.push({
        id: "skip-fake",
        status: "completed",
        conclusion: "success",
        outputs: {},
      });
      return;
    }

    if (event.type === "job:complete") {
      completeEventResult = event.result;
    }
  });

  const results = await scheduler.run(createBaseContext());
  const storedResults = scheduler.getResults();

  expect(completeEventResult !== undefined).toBeTruthy();
  expect(completeEventResult?.outputs.leaked).toEqual(undefined);
  expect(completeEventResult?.steps.find((step) => step.id === "skip-fake")).toEqual(undefined);
  expect(results.guarded.outputs.leaked).toEqual(undefined);
  expect(results.guarded.steps.find((step) => step.id === "skip-fake")).toEqual(undefined);
  expect(storedResults.guarded.outputs.leaked).toEqual(undefined);
  expect(storedResults.guarded.steps.find((step) => step.id === "skip-fake")).toEqual(undefined);
});
test("JobScheduler fail-fast behavior - skips dependent jobs when a needed job is skipped", async () => {
  const executedCommands: string[] = [];
  const shellExecutor: ShellExecutor = async (command) => {
    await Promise.resolve();
    executedCommands.push(command);
    return {
      exitCode: 0,
      stdout: "",
      stderr: "",
    };
  };

  const workflow: Workflow = {
    name: "needs-skipped-propagation",
    on: "push",
    jobs: {
      setup: {
        if: "${{ false }}",
        "runs-on": "ubuntu-latest",
        steps: [{ run: "setup" }],
      },
      build: {
        "runs-on": "ubuntu-latest",
        needs: "setup",
        steps: [{ run: "build" }],
      },
    },
  };

  const scheduler = new JobScheduler(workflow, {
    stepRunner: { shellExecutor },
  });

  const skipReasons: Record<string, string> = {};
  scheduler.on((event) => {
    if (event.type === "job:skip") {
      skipReasons[event.jobId] = event.reason;
    }
  });

  const results = await scheduler.run(createBaseContext());

  expect(executedCommands).toEqual([]);
  expect(results.setup.conclusion).toEqual("skipped");
  expect(results.build.conclusion).toEqual("skipped");
  expect(skipReasons.setup).toEqual("Condition not met");
  expect(skipReasons.build).toEqual('Dependency "setup" skipped');
});
test("JobScheduler fail-fast behavior - emits job:complete when a cancelled scheduler short-circuits runJob", async () => {
  const shellExecutor: ShellExecutor = async () => {
    await Promise.resolve();
    throw new Error("shell executor should not be called");
  };

  const workflow: Workflow = {
    name: "cancelled-runjob-complete-event",
    on: "push",
    jobs: {
      guarded: {
        "runs-on": "ubuntu-latest",
        steps: [{ run: "should-not-run" }],
      },
    },
  };

  const scheduler = new JobScheduler(workflow, {
    stepRunner: { shellExecutor },
  });

  const jobEvents: string[] = [];
  scheduler.on((event) => {
    if (
      event.type === "job:start" ||
      event.type === "job:skip" ||
      event.type === "job:complete"
    ) {
      jobEvents.push(event.type);
    }
  });

  scheduler.cancel();

  const internalScheduler = scheduler as unknown as {
    runJob: (jobId: string, context: ExecutionContext) => Promise<JobResult>;
  };

  const result = await internalScheduler.runJob("guarded", createBaseContext());
  expect(result.conclusion).toEqual("cancelled");
  expect(result.status).toEqual("completed");
  expect(jobEvents).toEqual(["job:complete"]);
  expect(scheduler.getResults().guarded !== result).toBeTruthy();
  expect(scheduler.getResults().guarded).toEqual(result);
});
test("JobScheduler fail-fast behavior - isolates internal results from job:complete event mutations", async () => {
  const workflow: Workflow = {
    name: "event-result-isolation",
    on: "push",
    jobs: {
      build: {
        "runs-on": "ubuntu-latest",
        steps: [{ run: "build" }],
      },
    },
  };

  const scheduler = new JobScheduler(workflow);
  scheduler.on((event) => {
    if (event.type !== "job:complete") {
      return;
    }

    event.result.outputs.leaked = "mutated-by-listener";
    event.result.steps.push({
      id: "fake",
      status: "completed",
      conclusion: "success",
      outputs: {},
    });
  });

  const results = await scheduler.run(createBaseContext());

  expect(results.build.outputs.leaked).toEqual(undefined);
  expect(results.build.steps.find((step) => step.id === "fake")).toEqual(undefined);
});
test("JobScheduler fail-fast behavior - isolates internal results from workflow:complete event mutations", async () => {
  const workflow: Workflow = {
    name: "workflow-complete-result-isolation",
    on: "push",
    jobs: {
      build: {
        "runs-on": "ubuntu-latest",
        steps: [{ run: "build" }],
      },
    },
  };

  const scheduler = new JobScheduler(workflow);
  scheduler.on((event) => {
    if (event.type !== "workflow:complete") {
      return;
    }

    event.results.build.outputs.leaked = "mutated-by-listener";
  });

  const results = await scheduler.run(createBaseContext());

  expect(results.build.outputs.leaked).toEqual(undefined);
  expect(scheduler.getResults().build.outputs.leaked).toEqual(undefined);
});
test("JobScheduler fail-fast behavior - returns result snapshots that cannot mutate scheduler state", async () => {
  const workflow: Workflow = {
    name: "results-snapshot-isolation",
    on: "push",
    jobs: {
      build: {
        "runs-on": "ubuntu-latest",
        steps: [{ run: "build" }],
      },
    },
  };

  const scheduler = new JobScheduler(workflow);
  const runResults = await scheduler.run(createBaseContext());
  runResults.build.outputs.leaked = "mutated-run-result";

  const snapshotAfterRunReturnMutation = scheduler.getResults();
  expect(snapshotAfterRunReturnMutation.build.outputs.leaked).toEqual(undefined);

  const firstSnapshot = scheduler.getResults();
  firstSnapshot.build.outputs.leaked = "mutated-by-caller";
  firstSnapshot.build.steps.push({
    id: "fake",
    status: "completed",
    conclusion: "success",
    outputs: {},
  });

  const secondSnapshot = scheduler.getResults();
  expect(secondSnapshot.build.outputs.leaked).toEqual(undefined);
  expect(secondSnapshot.build.steps.find((step) => step.id === "fake")).toEqual(undefined);
});
test("JobScheduler fail-fast behavior - guards against concurrent run invocations while a run is in progress", async () => {
  let unblockFirstRun = () => {};
  const blockFirstRun = new Promise<void>((resolve) => {
    unblockFirstRun = resolve;
  });
  const executedCommands: string[] = [];
  const shellExecutor: ShellExecutor = async (command) => {
    executedCommands.push(command);
    await blockFirstRun;
    return {
      exitCode: 0,
      stdout: "",
      stderr: "",
    };
  };

  const workflow: Workflow = {
    name: "concurrent-run-guard",
    on: "push",
    jobs: {
      build: {
        "runs-on": "ubuntu-latest",
        steps: [{ run: "build" }],
      },
    },
  };

  const scheduler = new JobScheduler(workflow, {
    stepRunner: { shellExecutor },
  });

  const firstRunPromise = scheduler.run(createBaseContext());

  await assertRejects(
    () => scheduler.run(createBaseContext()),
    Error,
    "JobScheduler is already running",
  );

  unblockFirstRun();
  const firstRunResults = await firstRunPromise;

  expect(executedCommands).toEqual(["build"]);
  expect(firstRunResults.build.conclusion).toEqual("success");
});
test("JobScheduler fail-fast behavior - isolates dependency outputs from needs context mutations", async () => {
  const workflow: Workflow = {
    name: "needs-context-output-isolation",
    on: "push",
    jobs: {
      setup: {
        "runs-on": "ubuntu-latest",
        steps: [{ id: "produce", run: "produce" }],
      },
      deploy: {
        "runs-on": "ubuntu-latest",
        needs: "setup",
        steps: [{ id: "mutate-needs", run: "deploy" }],
      },
    },
  };

  class MutatingNeedsStepRunner extends StepRunner {
    override async runStep(
      step: Step,
      context: ExecutionContext,
    ): Promise<StepResult> {
      await Promise.resolve();
      if (step.id === "mutate-needs" && context.needs.setup) {
        context.needs.setup.outputs.token = "mutated";
      }

      return {
        id: step.id,
        name: step.name,
        status: "completed",
        conclusion: "success",
        outputs: step.id === "produce" ? { token: "abc" } : {},
        startedAt: new Date(),
        completedAt: new Date(),
      };
    }
  }

  const scheduler = new JobScheduler(workflow);
  const internalScheduler = scheduler as unknown as { stepRunner: StepRunner };
  internalScheduler.stepRunner = new MutatingNeedsStepRunner();

  const results = await scheduler.run(createBaseContext());

  expect(results.setup.outputs.token).toEqual("abc");
  expect(scheduler.getResults().setup.outputs.token).toEqual("abc");
});
test("JobScheduler fail-fast behavior - isolates stored step outputs from steps context mutations", async () => {
  const workflow: Workflow = {
    name: "steps-context-output-isolation",
    on: "push",
    jobs: {
      build: {
        "runs-on": "ubuntu-latest",
        steps: [
          { id: "produce", run: "produce" },
          { id: "mutate-steps", run: "mutate" },
        ],
      },
    },
  };

  class MutatingStepsContextStepRunner extends StepRunner {
    override async runStep(
      step: Step,
      context: ExecutionContext,
    ): Promise<StepResult> {
      await Promise.resolve();
      if (step.id === "mutate-steps" && context.steps.produce) {
        context.steps.produce.outputs.artifact = "mutated";
      }

      return {
        id: step.id,
        name: step.name,
        status: "completed",
        conclusion: "success",
        outputs: step.id === "produce" ? { artifact: "dist.tar" } : {},
        startedAt: new Date(),
        completedAt: new Date(),
      };
    }
  }

  const scheduler = new JobScheduler(workflow);
  const internalScheduler = scheduler as unknown as { stepRunner: StepRunner };
  internalScheduler.stepRunner = new MutatingStepsContextStepRunner();

  const results = await scheduler.run(createBaseContext());

  expect(results.build.steps[0].outputs.artifact).toEqual("dist.tar");
  expect(results.build.outputs.artifact).toEqual("dist.tar");
  expect(scheduler.getResults().build.outputs.artifact).toEqual("dist.tar");
});
test("JobScheduler fail-fast behavior - resets cancellation/results between runs while preserving listeners", async () => {
  const executedCommands: string[] = [];
  let failBuildOnce = true;
  const shellExecutor: ShellExecutor = async (command) => {
    await Promise.resolve();
    executedCommands.push(command);

    if (command === "build" && failBuildOnce) {
      failBuildOnce = false;
      return {
        exitCode: 1,
        stdout: "",
        stderr: "forced first-run failure",
      };
    }

    return {
      exitCode: 0,
      stdout: "",
      stderr: "",
    };
  };

  const workflow: Workflow = {
    name: "scheduler-reset-across-runs",
    on: "push",
    jobs: {
      build: {
        "runs-on": "ubuntu-latest",
        steps: [{ run: "build" }],
      },
      deploy: {
        "runs-on": "ubuntu-latest",
        needs: "build",
        steps: [{ run: "deploy" }],
      },
    },
  };

  const scheduler = new JobScheduler(workflow, {
    failFast: true,
    stepRunner: { shellExecutor },
  });

  let workflowStarted = 0;
  let workflowCompleted = 0;
  scheduler.on((event) => {
    if (event.type === "workflow:start") {
      workflowStarted += 1;
    }
    if (event.type === "workflow:complete") {
      workflowCompleted += 1;
    }
  });

  const firstRun = await scheduler.run(createBaseContext());
  expect(firstRun.build.conclusion).toEqual("failure");
  expect(firstRun.deploy.conclusion).toEqual("cancelled");
  expect(scheduler.getConclusion()).toEqual("failure");

  const secondRun = await scheduler.run(createBaseContext());
  expect(secondRun.build.conclusion).toEqual("success");
  expect(secondRun.deploy.conclusion).toEqual("success");
  expect(scheduler.getConclusion()).toEqual("success");
  expect(executedCommands).toEqual(["build", "build", "deploy"]);
  expect(workflowStarted).toEqual(2);
  expect(workflowCompleted).toEqual(2);
});
test("JobScheduler fail-fast behavior - marks a job as failure when step runner throws unexpectedly", async () => {
  const workflow: Workflow = {
    name: "step-runner-throws",
    on: "push",
    jobs: {
      build: {
        "runs-on": "ubuntu-latest",
        steps: [{ run: "build" }],
      },
    },
  };

  class ThrowingStepRunner extends StepRunner {
    override async runStep(): Promise<StepResult> {
      await Promise.resolve();
      throw new Error("unexpected step runner failure");
    }
  }

  const scheduler = new JobScheduler(workflow);
  const internalScheduler = scheduler as unknown as { stepRunner: StepRunner };
  internalScheduler.stepRunner = new ThrowingStepRunner();

  const results = await scheduler.run(createBaseContext());
  expect(results.build.conclusion).toEqual("failure");
  expect(results.build.steps.length).toEqual(0);
});
test("JobScheduler fail-fast behavior - passes zero-based step index metadata to the step runner", async () => {
  const workflow: Workflow = {
    name: "step-index-metadata",
    on: "push",
    jobs: {
      build: {
        "runs-on": "ubuntu-latest",
        steps: [
          { id: "first", run: "first" },
          { id: "second", run: "second" },
          { id: "third", run: "third" },
        ],
      },
    },
  };

  class RecordingStepRunner extends StepRunner {
    public readonly indices: number[] = [];

    override async runStep(
      step: Step,
      _context: ExecutionContext,
      metadata: StepRunMetadata = {},
    ): Promise<StepResult> {
      await Promise.resolve();
      this.indices.push(metadata.index ?? -1);

      return {
        id: step.id,
        name: step.name,
        status: "completed",
        conclusion: "success",
        outputs: {},
        startedAt: new Date(),
        completedAt: new Date(),
      };
    }
  }

  const scheduler = new JobScheduler(workflow);
  const recordingRunner = new RecordingStepRunner();
  const internalScheduler = scheduler as unknown as {
    stepRunner: StepRunner;
  };
  internalScheduler.stepRunner = recordingRunner;

  await scheduler.run(createBaseContext());

  expect(recordingRunner.indices).toEqual([0, 1, 2]);
});
