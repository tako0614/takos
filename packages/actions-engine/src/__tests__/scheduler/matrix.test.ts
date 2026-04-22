import { assert, assertEquals } from "jsr:@std/assert";

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

Deno.test("expandMatrix - returns empty when strategy or matrix is missing", () => {
  assertEquals(expandMatrix(undefined), []);
  assertEquals(expandMatrix({}), []);
  assertEquals(expandMatrix({ matrix: {} }), []);
});

Deno.test("expandMatrix - expands simple cartesian product", () => {
  const expansions = expandMatrix({
    matrix: {
      os: ["ubuntu-latest", "windows-latest"],
      node: [18, 20],
    },
  });

  assertEquals(expansions.length, 4);
  const combinations = expansions.map((entry) => entry.matrix);
  assert(
    combinations.some(
      (entry) => entry?.os === "ubuntu-latest" && entry?.node === 18,
    ),
  );
  assert(
    combinations.some(
      (entry) => entry?.os === "ubuntu-latest" && entry?.node === 20,
    ),
  );
  assert(
    combinations.some(
      (entry) => entry?.os === "windows-latest" && entry?.node === 18,
    ),
  );
  assert(
    combinations.some(
      (entry) => entry?.os === "windows-latest" && entry?.node === 20,
    ),
  );

  // strategy metadata
  for (const entry of expansions) {
    assertEquals(entry.strategy["job-total"], 4);
    assertEquals(entry.strategy["fail-fast"], true);
  }
});

Deno.test("expandMatrix - applies exclude entries", () => {
  const expansions = expandMatrix({
    matrix: {
      os: ["ubuntu-latest", "windows-latest"],
      node: [18, 20],
      exclude: [{ os: "windows-latest", node: 18 }],
    },
  });

  assertEquals(expansions.length, 3);
  for (const entry of expansions) {
    assert(
      !(entry.matrix?.os === "windows-latest" && entry.matrix?.node === 18),
    );
  }
});

Deno.test("expandMatrix - applies include entries that extend existing combinations", () => {
  const expansions = expandMatrix({
    matrix: {
      os: ["ubuntu-latest", "windows-latest"],
      node: [18, 20],
      include: [{ os: "ubuntu-latest", node: 20, experimental: true }],
    },
  });

  assertEquals(expansions.length, 4);
  const matched = expansions.find(
    (entry) =>
      entry.matrix?.os === "ubuntu-latest" && entry.matrix?.node === 20,
  );
  assert(matched);
  assertEquals(matched.matrix?.experimental, true);
});

Deno.test("expandMatrix - adds non-matching include entries as new combinations", () => {
  const expansions = expandMatrix({
    matrix: {
      os: ["ubuntu-latest"],
      include: [{ os: "macos-latest", node: 20 }],
    },
  });

  // base cartesian has 1 entry, include adds one because os value does not match
  assertEquals(expansions.length, 2);
  const osValues = expansions.map((entry) => entry.matrix?.os).sort();
  assertEquals(osValues, ["macos-latest", "ubuntu-latest"]);
});

Deno.test("createExecutionPlan - expands matrix jobs into separate entries", () => {
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
  assertEquals(plan.phases.length, 1);
  assertEquals(plan.phases[0].length, 3);
  for (const jobId of plan.phases[0]) {
    assert(jobId.startsWith("test-"));
  }
});

Deno.test("JobScheduler - runs matrix combinations and populates context.matrix per execution", async () => {
  const observed: Array<{ node: unknown }> = [];

  class RecordingRunner extends StepRunner {
    override async runStep(
      step: Step,
      context: ExecutionContext,
    ): Promise<StepResult> {
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
  assertEquals(jobIds.length, 2);
  const nodeValues = observed.map((entry) => entry.node).sort();
  assertEquals(nodeValues, [18, 20]);

  // each expanded job carries matrix metadata
  for (const jobId of jobIds) {
    assert(results[jobId].matrix);
  }
});

Deno.test("JobScheduler - propagates matrix dependencies to downstream jobs", async () => {
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

  const executor: ShellExecutor = async () => ({
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
  assertEquals(jobIds.length, 3);
  assertEquals(
    jobIds.filter((id) => id.startsWith("build-")).length,
    2,
  );
  assert(jobIds.includes("deploy"));
  assertEquals(results.deploy.conclusion, "success");
});

Deno.test("JobScheduler - deploy waits for all matrix expansions and fails when any fails", async () => {
  const executed: string[] = [];
  const executor: ShellExecutor = async (command) => {
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

  assertEquals(results.deploy.conclusion, "skipped");
  assert(!executed.includes("deploy"));
});
