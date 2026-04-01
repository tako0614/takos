import { assertEquals } from "jsr:@std/assert";

import {
  isValidToolCallsArray,
  normalizeRunStatus,
} from "../../../../../../packages/control/src/application/services/agent/runner-history.ts";

const runnerHistorySource = new URL(
  "../../../../../../packages/control/src/application/services/agent/runner-history.ts",
  import.meta.url,
);

Deno.test("runner history - normalizes known statuses and rejects unknown values", () => {
  assertEquals(normalizeRunStatus("pending"), "pending");
  assertEquals(normalizeRunStatus("running"), "running");
  assertEquals(normalizeRunStatus("completed"), "completed");
  assertEquals(normalizeRunStatus("not-a-status"), null);
  assertEquals(normalizeRunStatus(undefined), null);
});

Deno.test("runner history - validates tool call arrays", () => {
  assertEquals(
    isValidToolCallsArray([
      {
        id: "tool-1",
        name: "file_read",
        arguments: {},
      },
    ]),
    true,
  );
  assertEquals(isValidToolCallsArray([]), true);
  assertEquals(
    isValidToolCallsArray([{ id: 1, name: "x", arguments: {} }]),
    false,
  );
  assertEquals(isValidToolCallsArray(null), false);
});

Deno.test("runner history - source keeps the delegation packet injection branch", async () => {
  const source = await Deno.readTextFile(runnerHistorySource);
  assertEquals(source.includes("buildDelegationSystemMessage"), true);
  assertEquals(source.includes("buildDelegationUserMessage"), true);
  assertEquals(source.includes("appendAttachmentContext"), true);
  assertEquals(source.includes("queryRelevantThreadMessages"), true);
});
