import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { Workflow } from "../../workflow-models.ts";
import { validateWorkflow } from "../../parser/validator.ts";
import {
  parseWorkflow,
  parseWorkflowFile,
  stringifyWorkflow,
} from "../../parser/workflow.ts";

import { assert, assertEquals } from "jsr:@std/assert";

Deno.test("workflow validation - reports unknown dependency diagnostics for string and array needs inputs", () => {
  const workflows: Workflow[] = [
    {
      on: "push",
      jobs: {
        setup: {
          "runs-on": "ubuntu-latest",
          steps: [{ run: "echo setup" }],
        },
        deploy: {
          "runs-on": "ubuntu-latest",
          needs: "missing-job",
          steps: [{ run: "echo deploy" }],
        },
      },
    },
    {
      on: "push",
      jobs: {
        setup: {
          "runs-on": "ubuntu-latest",
          steps: [{ run: "echo setup" }],
        },
        deploy: {
          "runs-on": "ubuntu-latest",
          needs: ["setup", "missing-job"],
          steps: [{ run: "echo deploy" }],
        },
      },
    },
  ];

  for (const workflow of workflows) {
    const result = validateWorkflow(workflow);

    assertEquals(result.valid, false);
    assert(
      result.diagnostics.some((item: any) =>
        JSON.stringify(item) === JSON.stringify({
          severity: "error",
          message: 'Job "deploy" references unknown job "missing-job" in needs',
          path: "jobs.deploy.needs",
        })
      ),
    );
  }
});
Deno.test("workflow validation - reports duplicate step id diagnostics", () => {
  const workflow: Workflow = {
    on: "push",
    jobs: {
      build: {
        "runs-on": "ubuntu-latest",
        steps: [
          { id: "duplicate", run: "echo first" },
          { id: "duplicate", run: "echo second" },
        ],
      },
    },
  };

  const result = validateWorkflow(workflow);

  assertEquals(result.valid, false);
  assert(
    result.diagnostics.some((item: any) =>
      item.severity === "error" &&
      typeof item.message === "string" &&
      item.message.includes("Duplicate step ID") &&
      item.path === "jobs.build.steps[1].id"
    ),
  );
});

Deno.test("workflow parser - normalizes string trigger and needs field while preserving workflow structure", () => {
  const yaml = [
    "name: sample",
    "on: push",
    "jobs:",
    "  build:",
    "    runs-on: ubuntu-latest",
    "    needs: setup",
    "    steps:",
    "      - run: echo build",
    "  setup:",
    "    runs-on: ubuntu-latest",
    "    steps:",
    "      - run: echo setup",
  ].join("\n");

  const parsed = parseWorkflow(yaml);

  assertEquals(parsed.workflow.on, { push: null });
  assertEquals(parsed.workflow.jobs.build.needs, ["setup"]);
  assertEquals(parsed.workflow.jobs.build.steps.length, 1);
});
Deno.test("workflow parser - roundtrips workflow objects through stringifyWorkflow and parseWorkflow", () => {
  const workflow: Workflow = {
    name: "roundtrip",
    on: { push: null },
    jobs: {
      build: {
        "runs-on": "ubuntu-latest",
        steps: [{ run: "echo build" }],
      },
    },
  };

  const yaml = stringifyWorkflow(workflow);
  const parsed = parseWorkflow(yaml);

  assertEquals(parsed.workflow.name, "roundtrip");
  assertEquals(parsed.workflow.jobs.build.steps[0]?.run, "echo build");
  assertEquals(parsed.workflow.on, { push: null });
});
Deno.test("workflow parser - normalizes single object schedule into array form", () => {
  const yaml = [
    "on:",
    "  schedule:",
    "    cron: '0 0 * * *'",
    "jobs:",
    "  build:",
    "    runs-on: ubuntu-latest",
    "    steps:",
    "      - run: echo build",
  ].join("\n");

  const parsed = parseWorkflow(yaml);

  const on = parsed.workflow.on as { schedule?: Array<{ cron: string }> };
  assertEquals(on.schedule, [{ cron: "0 0 * * *" }]);

  // validator も array 形式を受理する
  const result = validateWorkflow(parsed.workflow);
  assertEquals(result.valid, true);
});
Deno.test("workflow parser - passes through top-level run-name field", () => {
  const yaml = [
    "name: sample",
    "run-name: Deploy by @${{ github.actor }}",
    "on: push",
    "jobs:",
    "  build:",
    "    runs-on: ubuntu-latest",
    "    steps:",
    "      - run: echo build",
  ].join("\n");

  const parsed = parseWorkflow(yaml);

  assertEquals(parsed.workflow["run-name"], "Deploy by @${{ github.actor }}");

  // validator も run-name を受理する
  const result = validateWorkflow(parsed.workflow);
  assertEquals(result.valid, true);
});
Deno.test("workflow validation - rejects unknown pull_request event types", () => {
  const workflow: Workflow = {
    on: {
      pull_request: {
        types: ["opened", "not_a_real_event" as unknown as never],
      },
    },
    jobs: {
      build: {
        "runs-on": "ubuntu-latest",
        steps: [{ run: "echo build" }],
      },
    },
  };

  const result = validateWorkflow(workflow);

  assertEquals(result.valid, false);
  assert(
    result.diagnostics.some((item: any) =>
      item.severity === "error" &&
      typeof item.message === "string" &&
      item.message.includes("Invalid enum value") &&
      item.message.includes("not_a_real_event") &&
      typeof item.path === "string" &&
      item.path === "on.pull_request.types.1"
    ),
    `Expected enum validation error at on.pull_request.types.1, got ${
      JSON.stringify(result.diagnostics)
    }`,
  );
});
Deno.test("workflow validation - accepts all GitHub Actions pull_request types including assigned, labeled, milestoned, enqueued", () => {
  const workflow: Workflow = {
    on: {
      pull_request: {
        types: [
          "assigned",
          "unassigned",
          "labeled",
          "unlabeled",
          "opened",
          "edited",
          "closed",
          "reopened",
          "synchronize",
          "converted_to_draft",
          "ready_for_review",
          "locked",
          "unlocked",
          "review_requested",
          "review_request_removed",
          "auto_merge_enabled",
          "auto_merge_disabled",
          "milestoned",
          "demilestoned",
          "enqueued",
          "dequeued",
        ],
      },
    },
    jobs: {
      build: {
        "runs-on": "ubuntu-latest",
        steps: [{ run: "echo build" }],
      },
    },
  };

  const result = validateWorkflow(workflow);
  assertEquals(result.valid, true);
});
Deno.test("workflow parser - parses workflow files from disk", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "actions-engine-workflow-"));
  const filePath = join(tempDir, "workflow.yml");
  const yaml = [
    "on: [push, pull_request]",
    "jobs:",
    "  test:",
    "    runs-on: ubuntu-latest",
    "    steps:",
    "      - run: echo test",
  ].join("\n");

  try {
    await writeFile(filePath, yaml, "utf8");
    const parsed = await parseWorkflowFile(filePath);

    assertEquals(parsed.workflow.on, {
      push: null,
      pull_request: null,
    });
    assertEquals(parsed.workflow.jobs.test.steps[0]?.run, "echo test");
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});
