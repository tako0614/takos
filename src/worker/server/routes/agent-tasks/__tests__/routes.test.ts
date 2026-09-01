import { expect, test } from "bun:test";
import { assert, assertEquals, assertFalse } from "@takos/test/assert";

import {
  AGENT_TASK_CREATE_RATE_LIMIT,
  AGENT_TASK_PLAN_RATE_LIMIT,
  agentTaskCreateLimiter,
  agentTaskPlanLimiter,
  applyAgentTaskStatusTimestamps,
  createAgentTaskSchema,
  isTerminalAgentTaskStatus,
  patchAgentTaskSchema,
} from "../routes.ts";
import { VALID_STATUSES } from "../handlers.ts";
import {
  MAX_AGENT_TASK_DESCRIPTION_CHARACTERS,
  MAX_AGENT_TASK_PLAN_BYTES,
  MAX_AGENT_TASK_TITLE_CHARACTERS,
} from "../../../../shared/types/agent-tasks.ts";
import { deriveAgentTaskStartOperationIds } from "../../../../application/services/agent/task-start-operation.ts";

test("agent task statuses include failed", () => {
  assert(VALID_STATUSES.includes("failed"));
});

test("failed agent task status is terminal", () => {
  assert(isTerminalAgentTaskStatus("failed"));
  assert(isTerminalAgentTaskStatus("completed"));
  assertFalse(isTerminalAgentTaskStatus("blocked"));
});

test("terminal statuses populate completedAt when missing", () => {
  const updates: { startedAt?: string | null; completedAt?: string | null } =
    {};
  applyAgentTaskStatusTimestamps(updates, "failed", "2026-04-20T01:02:03.000Z");
  assertEquals(updates, {
    completedAt: "2026-04-20T01:02:03.000Z",
  });
});

test("non-terminal status transitions clear stale completion timestamps", () => {
  const updates: { startedAt?: string | null; completedAt?: string | null } =
    {};
  applyAgentTaskStatusTimestamps(
    updates,
    "blocked",
    "2026-04-20T01:02:03.000Z",
    {
      status: "completed",
      completedAt: "2026-04-19T01:02:03.000Z",
    },
  );
  assertEquals(updates, { completedAt: null });
});

test("resuming a task preserves its first start and clears completion", () => {
  const updates: { startedAt?: string | null; completedAt?: string | null } =
    {};
  applyAgentTaskStatusTimestamps(
    updates,
    "in_progress",
    "2026-04-20T01:02:03.000Z",
    {
      status: "completed",
      startedAt: "2026-04-18T01:02:03.000Z",
      completedAt: "2026-04-19T01:02:03.000Z",
    },
  );
  assertEquals(updates, {
    startedAt: "2026-04-18T01:02:03.000Z",
    completedAt: null,
  });
});

test("repeating a terminal state preserves its completion timestamp", () => {
  const updates: { startedAt?: string | null; completedAt?: string | null } =
    {};
  applyAgentTaskStatusTimestamps(
    updates,
    "completed",
    "2026-04-20T01:02:03.000Z",
    {
      status: "completed",
      completedAt: "2026-04-19T01:02:03.000Z",
    },
  );
  assertEquals(updates, {
    completedAt: "2026-04-19T01:02:03.000Z",
  });
});

test("public task edits reject execution-owned lifecycle projections", () => {
  assert(patchAgentTaskSchema.safeParse({
    title: "Editable",
    description: null,
    status: "blocked",
    model: null,
    due_at: null,
  }).success);

  for (
    const field of [
      "thread_id",
      "last_run_id",
      "started_at",
      "completed_at",
    ]
  ) {
    assertFalse(patchAgentTaskSchema.safeParse({ [field]: "forged" }).success);
  }
});

test("public task writes bound persisted text and plan input", () => {
  assertFalse(createAgentTaskSchema.safeParse({
    title: "x".repeat(MAX_AGENT_TASK_TITLE_CHARACTERS + 1),
  }).success);
  assertFalse(patchAgentTaskSchema.safeParse({
    description: "x".repeat(MAX_AGENT_TASK_DESCRIPTION_CHARACTERS + 1),
  }).success);
  assertFalse(patchAgentTaskSchema.safeParse({
    plan: "x".repeat(MAX_AGENT_TASK_PLAN_BYTES + 1),
  }).success);
  assertFalse(createAgentTaskSchema.safeParse({
    title: "valid",
    due_at: "tomorrow-ish",
  }).success);
  assertFalse(patchAgentTaskSchema.safeParse({
    plan: { type: "tool_only", tools: "shell" },
  }).success);
  assertFalse(patchAgentTaskSchema.safeParse({
    plan: JSON.stringify({ type: "tool_only", tools: "shell" }),
  }).success);
  assert(patchAgentTaskSchema.safeParse({
    plan: { type: "tool_only", tools: ["search"] },
  }).success);
});

test("Agent Task creation and LLM planning have explicit route budgets", () => {
  const createKey = `task-create-test-${crypto.randomUUID()}`;
  for (let i = 0; i < AGENT_TASK_CREATE_RATE_LIMIT; i++) {
    agentTaskCreateLimiter.hit(createKey);
  }
  assertEquals(agentTaskCreateLimiter.check(createKey).remaining, 0);

  const planKey = `task-plan-test-${crypto.randomUUID()}`;
  for (let i = 0; i < AGENT_TASK_PLAN_RATE_LIMIT; i++) {
    agentTaskPlanLimiter.hit(planKey);
  }
  assertEquals(agentTaskPlanLimiter.check(planKey).remaining, 0);
});

test("task start retries reuse side effects until the previous Run changes", async () => {
  const input = {
    taskId: "task_1",
    previousRunId: null,
    content: "Inspect the release",
    agentType: "reviewer",
    model: "gpt-5.5",
    locale: "ja" as const,
  };
  const first = await deriveAgentTaskStartOperationIds(input);
  expect(await deriveAgentTaskStartOperationIds(input)).toEqual(first);
  expect(new Set(Object.values(first)).size).toBe(3);
  expect(Object.values(first).every((id) => /^[a-f0-9]{32}$/.test(id))).toBe(
    true,
  );
  expect(await deriveAgentTaskStartOperationIds({
    ...input,
    previousRunId: "run_failed",
  })).not.toEqual(first);
});
