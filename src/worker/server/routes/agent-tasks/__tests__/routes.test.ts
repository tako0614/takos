import { test } from "bun:test";
import { assert, assertEquals, assertFalse } from "@takos/test/assert";

import {
  applyAgentTaskStatusTimestamps,
  isTerminalAgentTaskStatus,
} from "../routes.ts";
import { VALID_STATUSES } from "../handlers.ts";

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

test("non-terminal statuses do not set terminal timestamps", () => {
  const updates: { startedAt?: string | null; completedAt?: string | null } =
    {};
  applyAgentTaskStatusTimestamps(
    updates,
    "blocked",
    "2026-04-20T01:02:03.000Z",
  );
  assertEquals(updates, {});
});
