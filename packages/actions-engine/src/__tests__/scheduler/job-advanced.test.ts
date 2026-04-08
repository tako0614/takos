import { assert, assertEquals } from "jsr:@std/assert";

import { createBaseContext } from "../../context.ts";
import { JobScheduler } from "../../scheduler/job.ts";
import {
  type ShellExecutor,
  StepRunner,
} from "../../scheduler/step.ts";
import type {
  ExecutionContext,
  Step,
  StepResult,
  Workflow,
} from "../../workflow-models.ts";

// ============================================================================
// Job-level timeout-minutes (HIGH #2)
// ============================================================================

Deno.test("JobScheduler - enforces job-level timeout-minutes", async () => {
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

  assertEquals(results.slow.conclusion, "failure");
});

Deno.test("JobScheduler - ignores timeout-minutes when value is zero or missing", async () => {
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
      shellExecutor: async () => ({ exitCode: 0, stdout: "", stderr: "" }),
    },
  });
  const results = await scheduler.run(createBaseContext());
  assertEquals(results.quick.conclusion, "success");
});

// ============================================================================
// Job.outputs evaluation (HIGH #3)
// ============================================================================

Deno.test("JobScheduler - evaluates job.outputs via steps context", async () => {
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
  assertEquals(results.build.conclusion, "success");
  assertEquals(results.build.outputs.version, "1.2.3");
  assertEquals(results.build.outputs.label, "release-1.2.3");
});

Deno.test("JobScheduler - needs context reflects evaluated job.outputs", async () => {
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
  assertEquals(results.build.outputs.build_id, "42");

  // deploy ステップが needs.build.outputs.build_id にアクセスできること
  const deployContext = observedContexts.find(
    (context) => context.needs.build !== undefined,
  );
  assert(deployContext);
  assertEquals(deployContext.needs.build.outputs.build_id, "42");
});

// ============================================================================
// Secret masking (MEDIUM #1)
// ============================================================================

Deno.test("JobScheduler - masks secret values in stdout-derived outputs", async () => {
  const secretValue = "supersecrettoken123";
  const executor: ShellExecutor = async () => ({
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
        steps: [{ id: "leak", run: 'echo result=${{ secrets.TOKEN }}' }],
      },
    },
  };

  const scheduler = new JobScheduler(workflow, {
    stepRunner: { shellExecutor: executor },
  });

  const results = await scheduler.run(
    createBaseContext({ secrets: { TOKEN: secretValue } }),
  );

  assertEquals(results.build.steps[0].outputs.result, "***");
});

Deno.test("JobScheduler - masks secret values in stderr error messages", async () => {
  const secretValue = "supersecrettoken123";
  const executor: ShellExecutor = async () => ({
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
  assert(!errorMessage.includes(secretValue));
  assert(errorMessage.includes("***"));
});

// ============================================================================
// Defaults.run inheritance (MEDIUM #2)
// ============================================================================

Deno.test("JobScheduler - falls back to workflow.defaults.run.shell when step omits shell", async () => {
  let observedShell: string | undefined;
  const executor: ShellExecutor = async (_command, options) => {
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
  assertEquals(observedShell, "bash");
});

Deno.test("JobScheduler - job.defaults.run.shell overrides workflow defaults", async () => {
  let observedShell: string | undefined;
  const executor: ShellExecutor = async (_command, options) => {
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
  assertEquals(observedShell, "sh");
});

Deno.test("JobScheduler - step.shell beats job and workflow defaults", async () => {
  let observedShell: string | undefined;
  const executor: ShellExecutor = async (_command, options) => {
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
  assertEquals(observedShell, "pwsh");
});

Deno.test("JobScheduler - workflow.defaults.run.working-directory applies when step omits it", async () => {
  let observedCwd: string | undefined;
  const executor: ShellExecutor = async (_command, options) => {
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
  assertEquals(observedCwd, "/workspace/subdir");
});

// ============================================================================
// outcome vs conclusion (MEDIUM #3)
// ============================================================================

Deno.test("StepResult - distinguishes raw outcome from continue-on-error conclusion", async () => {
  const executor: ShellExecutor = async () => ({
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
  assertEquals(result.outcome, "failure");
  assertEquals(result.conclusion, "success");
});

Deno.test("buildStepsContext - reports outcome=failure even when continue-on-error rewrites conclusion", async () => {
  const executor: ShellExecutor = async () => ({
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

  const observedContext = observed[0];
  assert(observedContext);
  assertEquals(observedContext.steps.flaky.outcome, "failure");
  assertEquals(observedContext.steps.flaky.conclusion, "success");
});

// ============================================================================
// Exports (HIGH #6)
// ============================================================================

Deno.test("package surface - exports runtime classes and helpers", async () => {
  const pkg = await import("../../index.ts");
  assert(typeof pkg.JobScheduler === "function");
  assert(typeof pkg.StepRunner === "function");
  assert(typeof pkg.createBaseContext === "function");
  assert(typeof pkg.parseGitHubEnvFile === "function");
});
