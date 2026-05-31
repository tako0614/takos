import { expect, test } from "bun:test";

import { createBaseContext } from "../../context.ts";
import { JobScheduler } from "../../scheduler/job.ts";
import { type ShellExecutor, StepRunner } from "../../scheduler/step.ts";
import type {
  ExecutionContext,
  Step,
  StepResult,
  Workflow,
} from "../../workflow-models.ts";

// ============================================================================
// Job-level timeout-minutes (HIGH #2)
// ============================================================================

test("JobScheduler - enforces job-level timeout-minutes", async () => {
  let resolveStep: () => void = () => {};
  const stepPromise = new Promise<void>((resolve) => {
    resolveStep = resolve;
  });

  class LongRunningRunner extends StepRunner {
    override async runStep(step: Step): Promise<StepResult> {
      // 長時間ブロックするステップを模擬
      await stepPromise;
      return {
        id: step.id,
        name: step.name,
        status: "completed",
        conclusion: "success",
        outputs: {},
      };
    }
  }

  const workflow: Workflow = {
    name: "job-timeout",
    on: "push",
    jobs: {
      slow: {
        "runs-on": "ubuntu-latest",
        // 0.0005 分 = 30ms
        "timeout-minutes": 0.0005,
        steps: [{ run: "sleep" }],
      },
    },
  };

  const scheduler = new JobScheduler(workflow, { failFast: false });
  const internal = scheduler as unknown as { stepRunner: StepRunner };
  internal.stepRunner = new LongRunningRunner();

  // wait for the timeout to complete naturally
  const runPromise = scheduler.run(createBaseContext());
  // Wait longer than timeout then unblock the stub step runner
  await new Promise((r) => setTimeout(r, 80));
  resolveStep();
  const results = await runPromise;

  expect(results.slow.conclusion).toEqual("failure");
});

test("JobScheduler - ignores timeout-minutes when value is zero or missing", async () => {
  const workflow: Workflow = {
    name: "job-no-timeout",
    on: "push",
    jobs: {
      quick: {
        "runs-on": "ubuntu-latest",
        "timeout-minutes": 0,
        steps: [{ run: "echo ok" }],
      },
    },
  };

  const scheduler = new JobScheduler(workflow, {
    stepRunner: {
      shellExecutor: () =>
        Promise.resolve({ exitCode: 0, stdout: "", stderr: "" }),
    },
  });
  const results = await scheduler.run(createBaseContext());
  expect(results.quick.conclusion).toEqual("success");
});

// ============================================================================
// Job.outputs evaluation (HIGH #3)
// ============================================================================

test("JobScheduler - evaluates job.outputs via steps context", async () => {
  const workflow: Workflow = {
    name: "job-outputs",
    on: "push",
    jobs: {
      build: {
        "runs-on": "ubuntu-latest",
        outputs: {
          version: "${{ steps.produce.outputs.version }}",
          label: "release-${{ steps.produce.outputs.version }}",
        },
        steps: [
          { id: "produce", run: "echo version=1.2.3" },
        ],
      },
    },
  };

  class VersionRunner extends StepRunner {
    override async runStep(step: Step): Promise<StepResult> {
      await Promise.resolve();
      return {
        id: step.id,
        name: step.name,
        status: "completed",
        conclusion: "success",
        outcome: "success",
        outputs: { version: "1.2.3" },
      };
    }
  }

  const scheduler = new JobScheduler(workflow);
  const internal = scheduler as unknown as { stepRunner: StepRunner };
  internal.stepRunner = new VersionRunner();

  const results = await scheduler.run(createBaseContext());
  expect(results.build.conclusion).toEqual("success");
  expect(results.build.outputs.version).toEqual("1.2.3");
  expect(results.build.outputs.label).toEqual("release-1.2.3");
});

test("JobScheduler - needs context reflects evaluated job.outputs", async () => {
  const workflow: Workflow = {
    name: "needs-outputs",
    on: "push",
    jobs: {
      build: {
        "runs-on": "ubuntu-latest",
        outputs: {
          build_id: "${{ steps.produce.outputs.build_id }}",
        },
        steps: [
          { id: "produce", run: "echo build_id=42" },
        ],
      },
      deploy: {
        "runs-on": "ubuntu-latest",
        needs: "build",
        steps: [
          { id: "show", run: "echo ${{ needs.build.outputs.build_id }}" },
        ],
      },
    },
  };

  const observedContexts: ExecutionContext[] = [];

  class RecordingRunner extends StepRunner {
    override async runStep(
      step: Step,
      context: ExecutionContext,
    ): Promise<StepResult> {
      await Promise.resolve();
      observedContexts.push(context);
      return {
        id: step.id,
        name: step.name,
        status: "completed",
        conclusion: "success",
        outcome: "success",
        outputs: step.id === "produce" ? { build_id: "42" } : {},
      };
    }
  }

  const scheduler = new JobScheduler(workflow);
  const internal = scheduler as unknown as { stepRunner: StepRunner };
  internal.stepRunner = new RecordingRunner();

  const results = await scheduler.run(createBaseContext());
  expect(results.build.outputs.build_id).toEqual("42");

  // deploy ステップが needs.build.outputs.build_id にアクセスできること
  const deployContext = observedContexts.find(
    (context) => context.needs.build !== undefined,
  );
  expect(deployContext).toBeTruthy();
  expect(deployContext.needs.build.outputs.build_id).toEqual("42");
});

// ============================================================================
// Secret masking (MEDIUM #1)
// ============================================================================

test("JobScheduler - masks secret values in stdout-derived outputs", async () => {
  const secretValue = "supersecrettoken123";
  const executor: ShellExecutor = () =>
    Promise.resolve({
      exitCode: 0,
      stdout: `result=${secretValue}`,
      stderr: "",
    });

  const workflow: Workflow = {
    name: "secret-masking",
    on: "push",
    jobs: {
      build: {
        "runs-on": "ubuntu-latest",
        steps: [{ id: "leak", run: "echo result=${{ secrets.TOKEN }}" }],
      },
    },
  };

  const scheduler = new JobScheduler(workflow, {
    stepRunner: { shellExecutor: executor },
  });

  const results = await scheduler.run(
    createBaseContext({ secrets: { TOKEN: secretValue } }),
  );

  expect(results.build.steps[0].outputs.result).toEqual("***");
});

test("JobScheduler - masks secret values in stderr error messages", async () => {
  const secretValue = "supersecrettoken123";
  const executor: ShellExecutor = () =>
    Promise.resolve({
      exitCode: 1,
      stdout: "",
      stderr: `Connection failed using token ${secretValue}`,
    });

  const workflow: Workflow = {
    name: "secret-masking-error",
    on: "push",
    jobs: {
      build: {
        "runs-on": "ubuntu-latest",
        steps: [{ id: "leak", run: "false" }],
      },
    },
  };

  const scheduler = new JobScheduler(workflow, {
    failFast: false,
    stepRunner: { shellExecutor: executor },
  });

  const results = await scheduler.run(
    createBaseContext({ secrets: { TOKEN: secretValue } }),
  );

  const errorMessage = results.build.steps[0].error ?? "";
  expect(!errorMessage.includes(secretValue)).toBeTruthy();
  expect(errorMessage.includes("***")).toBeTruthy();
});

// ============================================================================
// Defaults.run inheritance (MEDIUM #2)
// ============================================================================

test("JobScheduler - falls back to workflow.defaults.run.shell when step omits shell", async () => {
  let observedShell: string | undefined;
  const executor: ShellExecutor = async (_command, options) => {
    await Promise.resolve();
    observedShell = options.shell;
    return { exitCode: 0, stdout: "", stderr: "" };
  };

  const workflow: Workflow = {
    name: "workflow-defaults-shell",
    on: "push",
    defaults: {
      run: { shell: "bash" },
    },
    jobs: {
      build: {
        "runs-on": "ubuntu-latest",
        steps: [{ run: "echo ok" }],
      },
    },
  };

  const scheduler = new JobScheduler(workflow, {
    stepRunner: { shellExecutor: executor, defaultShell: "sh" },
  });
  await scheduler.run(createBaseContext());
  expect(observedShell).toEqual("bash");
});

test("JobScheduler - job.defaults.run.shell overrides workflow defaults", async () => {
  let observedShell: string | undefined;
  const executor: ShellExecutor = async (_command, options) => {
    await Promise.resolve();
    observedShell = options.shell;
    return { exitCode: 0, stdout: "", stderr: "" };
  };

  const workflow: Workflow = {
    name: "job-defaults-shell",
    on: "push",
    defaults: {
      run: { shell: "bash" },
    },
    jobs: {
      build: {
        "runs-on": "ubuntu-latest",
        defaults: {
          run: { shell: "sh" },
        },
        steps: [{ run: "echo ok" }],
      },
    },
  };

  const scheduler = new JobScheduler(workflow, {
    stepRunner: { shellExecutor: executor },
  });
  await scheduler.run(createBaseContext());
  expect(observedShell).toEqual("sh");
});

test("JobScheduler - step.shell beats job and workflow defaults", async () => {
  let observedShell: string | undefined;
  const executor: ShellExecutor = async (_command, options) => {
    await Promise.resolve();
    observedShell = options.shell;
    return { exitCode: 0, stdout: "", stderr: "" };
  };

  const workflow: Workflow = {
    name: "step-shell-beats-defaults",
    on: "push",
    defaults: { run: { shell: "bash" } },
    jobs: {
      build: {
        "runs-on": "ubuntu-latest",
        defaults: { run: { shell: "sh" } },
        steps: [{ run: "echo ok", shell: "pwsh" }],
      },
    },
  };

  const scheduler = new JobScheduler(workflow, {
    stepRunner: { shellExecutor: executor },
  });
  await scheduler.run(createBaseContext());
  expect(observedShell).toEqual("pwsh");
});

test("JobScheduler - workflow.defaults.run.working-directory applies when step omits it", async () => {
  let observedCwd: string | undefined;
  const executor: ShellExecutor = async (_command, options) => {
    await Promise.resolve();
    observedCwd = options.workingDirectory;
    return { exitCode: 0, stdout: "", stderr: "" };
  };

  const workflow: Workflow = {
    name: "workflow-defaults-cwd",
    on: "push",
    defaults: {
      run: {
        "working-directory": "/workspace/subdir",
      },
    },
    jobs: {
      build: {
        "runs-on": "ubuntu-latest",
        steps: [{ run: "echo ok" }],
      },
    },
  };

  const scheduler = new JobScheduler(workflow, {
    stepRunner: { shellExecutor: executor },
  });
  await scheduler.run(createBaseContext());
  expect(observedCwd).toEqual("/workspace/subdir");
});

// ============================================================================
// outcome / conclusion compatibility
// ============================================================================

test("StepResult - mirrors outcome to conclusion", async () => {
  const executor: ShellExecutor = () =>
    Promise.resolve({
      exitCode: 1,
      stdout: "",
      stderr: "boom",
    });

  const runner = new StepRunner({ shellExecutor: executor });
  const step: Step = {
    id: "flaky",
    run: "false",
    "continue-on-error": true,
  };

  const result = await runner.runStep(step, createBaseContext());
  expect(result.outcome).toEqual("failure");
  expect(result.conclusion).toEqual("failure");
});

test("JobScheduler - treats continue-on-error as unsupported status rewrite", async () => {
  const executor: ShellExecutor = () =>
    Promise.resolve({
      exitCode: 1,
      stdout: "",
      stderr: "boom",
    });

  const workflow: Workflow = {
    name: "outcome-vs-conclusion",
    on: "push",
    jobs: {
      build: {
        "runs-on": "ubuntu-latest",
        steps: [
          { id: "flaky", run: "false", "continue-on-error": true },
          { id: "observe", run: "echo ok" },
        ],
      },
    },
  };

  const observed: ExecutionContext[] = [];

  class RecordingRunner extends StepRunner {
    override async runStep(
      step: Step,
      context: ExecutionContext,
      metadata = {},
    ): Promise<StepResult> {
      if (step.id === "observe") {
        observed.push(context);
      }
      await Promise.resolve();
      return super.runStep(step, context, metadata);
    }
  }

  const scheduler = new JobScheduler(workflow, {
    failFast: false,
    stepRunner: { shellExecutor: executor },
  });
  const internal = scheduler as unknown as { stepRunner: StepRunner };
  internal.stepRunner = new RecordingRunner({ shellExecutor: executor });

  await scheduler.run(createBaseContext());

  expect(observed.length).toEqual(0);
});

// ============================================================================
// Exports (HIGH #6 / demoted to parser/validator/planner surface)
// ============================================================================

test("package surface - exposes planner/parser only, not the runtime engine", async () => {
  const pkg = await import("../../index.ts") as Record<string, unknown>;
  // planner / parser surface remains public
  expect(typeof pkg.createExecutionPlan === "function").toBeTruthy();
  expect(typeof pkg.parseWorkflow === "function").toBeTruthy();
  expect(typeof pkg.validateWorkflow === "function").toBeTruthy();
  // runtime engine is intentionally NOT advertised from the package surface;
  // control plane re-implements its own queue-distributed executor.
  expect(pkg.JobScheduler).toEqual(undefined);
  expect(pkg.StepRunner).toEqual(undefined);
  expect(pkg.createBaseContext).toEqual(undefined);
  expect(pkg.parseGitHubEnvFile).toEqual(undefined);
});
