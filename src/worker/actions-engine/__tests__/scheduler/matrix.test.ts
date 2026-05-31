import { expect, test } from "bun:test";

import { createBaseContext } from "../../context.ts";
import { createExecutionPlan, JobScheduler } from "../../scheduler/job.ts";
import { expandMatrix } from "../../scheduler/matrix.ts";
import { type ShellExecutor, StepRunner } from "../../scheduler/step.ts";
import type {
  ExecutionContext,
  Step,
  StepResult,
  Workflow,
} from "../../workflow-models.ts";

test("expandMatrix - returns empty when strategy or matrix is missing", () => {
  expect(expandMatrix(undefined)).toEqual([]);
  expect(expandMatrix({})).toEqual([]);
  expect(expandMatrix({ matrix: {} })).toEqual([]);
});

test("expandMatrix - expands simple cartesian product", () => {
  const expansions = expandMatrix({
    matrix: {
      os: ["ubuntu-latest", "windows-latest"],
      node: [18, 20],
    },
  });

  expect(expansions.length).toEqual(4);
  const combinations = expansions.map((entry) => entry.matrix);
  expect(combinations.some(
      (entry) => entry?.os === "ubuntu-latest" && entry?.node === 18,
    )).toBeTruthy();
  expect(combinations.some(
      (entry) => entry?.os === "ubuntu-latest" && entry?.node === 20,
    )).toBeTruthy();
  expect(combinations.some(
      (entry) => entry?.os === "windows-latest" && entry?.node === 18,
    )).toBeTruthy();
  expect(combinations.some(
      (entry) => entry?.os === "windows-latest" && entry?.node === 20,
    )).toBeTruthy();

  // strategy metadata
  for (const entry of expansions) {
    expect(entry.strategy["job-total"]).toEqual(4);
    expect(entry.strategy["fail-fast"]).toEqual(true);
  }
});

test("expandMatrix - applies exclude entries", () => {
  const expansions = expandMatrix({
    matrix: {
      os: ["ubuntu-latest", "windows-latest"],
      node: [18, 20],
      exclude: [{ os: "windows-latest", node: 18 }],
    },
  });

  expect(expansions.length).toEqual(3);
  for (const entry of expansions) {
    expect(!(entry.matrix?.os === "windows-latest" && entry.matrix?.node === 18)).toBeTruthy();
  }
});

test("expandMatrix - applies include entries that extend existing combinations", () => {
  const expansions = expandMatrix({
    matrix: {
      os: ["ubuntu-latest", "windows-latest"],
      node: [18, 20],
      include: [{ os: "ubuntu-latest", node: 20, experimental: true }],
    },
  });

  expect(expansions.length).toEqual(4);
  const matched = expansions.find(
    (entry) =>
      entry.matrix?.os === "ubuntu-latest" && entry.matrix?.node === 20,
  );
  expect(matched).toBeTruthy();
  expect(matched.matrix?.experimental).toEqual(true);
});

test("expandMatrix - adds non-matching include entries as new combinations", () => {
  const expansions = expandMatrix({
    matrix: {
      os: ["ubuntu-latest"],
      include: [{ os: "macos-latest", node: 20 }],
    },
  });

  // base cartesian has 1 entry, include adds one because os value does not match
  expect(expansions.length).toEqual(2);
  const osValues = expansions.map((entry) => entry.matrix?.os).sort();
  expect(osValues).toEqual(["macos-latest", "ubuntu-latest"]);
});

test("createExecutionPlan - expands matrix jobs into separate entries", () => {
  const workflow: Workflow = {
    name: "matrix-plan",
    on: "push",
    jobs: {
      test: {
        "runs-on": "ubuntu-latest",
        strategy: {
          matrix: {
            node: [18, 20, 22],
          },
        },
        steps: [{ run: "npm test" }],
      },
    },
  };

  const plan = createExecutionPlan(workflow);
  expect(plan.phases.length).toEqual(1);
  expect(plan.phases[0].length).toEqual(3);
  for (const jobId of plan.phases[0]) {
    expect(jobId.startsWith("test-")).toBeTruthy();
  }
});

test("JobScheduler - runs matrix combinations and populates context.matrix per execution", async () => {
  const observed: Array<{ node: unknown }> = [];

  class RecordingRunner extends StepRunner {
    override async runStep(
      step: Step,
      context: ExecutionContext,
    ): Promise<StepResult> {
      await Promise.resolve();
      observed.push({ node: context.matrix?.node });
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
    name: "matrix-run",
    on: "push",
    jobs: {
      test: {
        "runs-on": "ubuntu-latest",
        strategy: {
          matrix: {
            node: [18, 20],
          },
        },
        steps: [{ id: "run", run: "echo ok" }],
      },
    },
  };

  const scheduler = new JobScheduler(workflow, { failFast: false });
  const internal = scheduler as unknown as { stepRunner: StepRunner };
  internal.stepRunner = new RecordingRunner();

  const results = await scheduler.run(createBaseContext());

  const jobIds = Object.keys(results);
  expect(jobIds.length).toEqual(2);
  const nodeValues = observed.map((entry) => entry.node).sort();
  expect(nodeValues).toEqual([18, 20]);

  // each expanded job carries matrix metadata
  for (const jobId of jobIds) {
    expect(results[jobId].matrix).toBeTruthy();
  }
});

test("JobScheduler - propagates matrix dependencies to downstream jobs", async () => {
  const workflow: Workflow = {
    name: "matrix-needs",
    on: "push",
    jobs: {
      build: {
        "runs-on": "ubuntu-latest",
        strategy: {
          matrix: {
            node: [18, 20],
          },
        },
        steps: [{ run: "echo ok" }],
      },
      deploy: {
        "runs-on": "ubuntu-latest",
        needs: "build",
        steps: [{ run: "echo deploy" }],
      },
    },
  };

  const executor: ShellExecutor = () =>
    Promise.resolve({
      exitCode: 0,
      stdout: "",
      stderr: "",
    });
  const scheduler = new JobScheduler(workflow, {
    stepRunner: { shellExecutor: executor },
  });
  const results = await scheduler.run(createBaseContext());

  // 2 build expansions + 1 deploy = 3 jobs
  const jobIds = Object.keys(results).sort();
  expect(jobIds.length).toEqual(3);
  expect(jobIds.filter((id) => id.startsWith("build-")).length).toEqual(2);
  expect(jobIds.includes("deploy")).toBeTruthy();
  expect(results.deploy.conclusion).toEqual("success");
});

test("JobScheduler - enforces strategy.max-parallel within a matrix group", async () => {
  let active = 0;
  let peak = 0;
  const executor: ShellExecutor = async () => {
    active++;
    peak = Math.max(peak, active);
    // 並列性を観測するため microtask 境界を跨いで待つ
    await new Promise((resolve) => setTimeout(resolve, 5));
    active--;
    return { exitCode: 0, stdout: "", stderr: "" };
  };

  const workflow: Workflow = {
    name: "matrix-max-parallel",
    on: "push",
    jobs: {
      test: {
        "runs-on": "ubuntu-latest",
        strategy: {
          "max-parallel": 1,
          matrix: { node: [18, 20, 22] },
        },
        steps: [{ run: "echo ok" }],
      },
    },
  };

  const scheduler = new JobScheduler(workflow, {
    failFast: false,
    stepRunner: { shellExecutor: executor },
  });
  const results = await scheduler.run(createBaseContext());

  // 3 legs all ran...
  expect(Object.keys(results).length).toEqual(3);
  for (const id of Object.keys(results)) {
    expect(results[id].conclusion).toEqual("success");
  }
  // ...but never more than 1 concurrently (max-parallel: 1 is now honored).
  expect(peak).toEqual(1);
});

test("JobScheduler - strategy.fail-fast cancels sibling matrix legs on first failure", async () => {
  const started: string[] = [];
  const executor: ShellExecutor = async (command) => {
    started.push(command);
    await new Promise((resolve) => setTimeout(resolve, 5));
    if (command === "fail") {
      return { exitCode: 1, stdout: "", stderr: "boom" };
    }
    return { exitCode: 0, stdout: "", stderr: "" };
  };

  const workflow: Workflow = {
    name: "matrix-fail-fast",
    on: "push",
    jobs: {
      test: {
        "runs-on": "ubuntu-latest",
        strategy: {
          "fail-fast": true,
          "max-parallel": 1,
          // first leg fails; remaining legs should be cancelled, not run.
          matrix: { variant: ["fail", "later-a", "later-b"] },
        },
        steps: [{ run: "${{ matrix.variant }}" }],
      },
    },
  };

  const scheduler = new JobScheduler(workflow, {
    // disable GLOBAL fail-fast so we isolate the per-strategy behavior
    failFast: false,
    stepRunner: { shellExecutor: executor },
  });
  const results = await scheduler.run(createBaseContext());

  const conclusions = Object.values(results).map((r) => r.conclusion).sort();
  // one failure + two cancelled
  expect(conclusions).toEqual(["cancelled", "cancelled", "failure"]);
  // the later legs' commands must never have reached the executor
  expect(!started.includes("later-a")).toBeTruthy();
  expect(!started.includes("later-b")).toBeTruthy();
});

test("JobScheduler - deploy waits for all matrix expansions and fails when any fails", async () => {
  const executed: string[] = [];
  const executor: ShellExecutor = async (command) => {
    await Promise.resolve();
    executed.push(command);
    if (command === "fail") {
      return { exitCode: 1, stdout: "", stderr: "build failed" };
    }
    return { exitCode: 0, stdout: "", stderr: "" };
  };

  const workflow: Workflow = {
    name: "matrix-dependency-failure",
    on: "push",
    jobs: {
      build: {
        "runs-on": "ubuntu-latest",
        strategy: {
          matrix: {
            variant: ["pass", "fail"],
          },
        },
        steps: [{ run: "${{ matrix.variant }}" }],
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
    stepRunner: { shellExecutor: executor },
  });
  const results = await scheduler.run(createBaseContext());

  expect(results.deploy.conclusion).toEqual("skipped");
  expect(!executed.includes("deploy")).toBeTruthy();
});
