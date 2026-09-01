import {
  deepStrictEqual as assertEquals,
  throws as assertThrows,
} from "node:assert/strict";
import { test } from "bun:test";
import { readAgentTaskListResponse } from "../../../views/agent/work/task-response.ts";

const now = "2026-08-09T20:00:00.000Z";

function task(overrides: Record<string, unknown> = {}) {
  return {
    id: "task-1",
    space_id: "space-1",
    created_by: "user-1",
    thread_id: "thread-1",
    last_run_id: "run-1",
    title: "Inspect release evidence",
    description: null,
    status: "planned",
    priority: "high",
    agent_type: "reviewer",
    model: null,
    plan: null,
    due_at: null,
    started_at: null,
    completed_at: null,
    created_at: now,
    updated_at: now,
    thread_title: "Release review",
    latest_run: {
      run_id: "run-1",
      status: "failed",
      agent_type: "reviewer",
      started_at: now,
      completed_at: now,
      created_at: now,
      error: "Needs another pass",
      artifact_count: 2,
    },
    resume_target: {
      thread_id: "thread-1",
      run_id: "run-1",
      reason: "failed",
    },
    ...overrides,
  };
}

test("Agent Task response parser accepts one exact enriched task", () => {
  const input = task();
  assertEquals(readAgentTaskListResponse({ tasks: [input] }), [input]);
});

test("Agent Task response parser rejects malformed display and execution state", () => {
  assertThrows(() => readAgentTaskListResponse({
    tasks: [task({ status: "forged" })],
  }));
  assertThrows(() => readAgentTaskListResponse({
    tasks: [task({ latest_run: { ...task().latest_run as object, artifact_count: -1 } })],
  }));
  assertThrows(() => readAgentTaskListResponse({
    tasks: [task({ resume_target: {
      thread_id: "thread-other",
      run_id: "run-1",
      reason: "failed",
    } })],
  }));
  assertThrows(() => readAgentTaskListResponse({
    tasks: [task(), task()],
  }));
  assertThrows(() => readAgentTaskListResponse({
    tasks: [task(), task({ id: "task-2", space_id: "space-2" })],
  }));
});
