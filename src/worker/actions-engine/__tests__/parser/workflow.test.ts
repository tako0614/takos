import { expect, test } from "bun:test";

import type { Workflow } from "../../workflow-models.ts";
import { validateWorkflow } from "../../parser/validator.ts";
import { parseWorkflow } from "../../parser/workflow.ts";

test("workflow validation - reports unknown dependency diagnostics for string and array needs inputs", () => {
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

    expect(result.valid).toEqual(false);
    expect(result.diagnostics.some((item) =>
        JSON.stringify(item) === JSON.stringify({
          severity: "error",
          message: 'Job "deploy" references unknown job "missing-job" in needs',
          path: "jobs.deploy.needs",
        })
      )).toBeTruthy();
  }
});
test("workflow validation - reports duplicate step id diagnostics", () => {
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

  expect(result.valid).toEqual(false);
  expect(result.diagnostics.some((item) =>
      item.severity === "error" &&
      typeof item.message === "string" &&
      item.message.includes("Duplicate step ID") &&
      item.path === "jobs.build.steps[1].id"
    )).toBeTruthy();
});

test("workflow parser - normalizes string trigger and needs field while preserving workflow structure", () => {
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

  expect(parsed.workflow.on).toEqual({ push: null });
  expect(parsed.workflow.jobs.build.needs).toEqual(["setup"]);
  expect(parsed.workflow.jobs.build.steps.length).toEqual(1);
});
test("workflow parser - normalizes single object schedule into array form", () => {
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
  expect(on.schedule).toEqual([{ cron: "0 0 * * *" }]);

  // validator も array 形式を受理する
  const result = validateWorkflow(parsed.workflow);
  expect(result.valid).toEqual(true);
});
test("workflow parser - passes through top-level run-name field", () => {
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

  expect(parsed.workflow["run-name"]).toEqual("Deploy by @${{ github.actor }}");

  // validator も run-name を受理する
  const result = validateWorkflow(parsed.workflow);
  expect(result.valid).toEqual(true);
});
test("workflow validation - rejects unknown pull_request event types", () => {
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

  expect(result.valid).toEqual(false);
  expect(result.diagnostics.some((item) =>
      item.severity === "error" &&
      typeof item.message === "string" &&
      item.message.includes("Invalid enum value") &&
      item.message.includes("not_a_real_event") &&
      typeof item.path === "string" &&
      item.path === "on.pull_request.types.1"
    )).toBeTruthy();
});
test("workflow validation - accepts all GitHub Actions pull_request types including assigned, labeled, milestoned, enqueued", () => {
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
  expect(result.valid).toEqual(true);
});
