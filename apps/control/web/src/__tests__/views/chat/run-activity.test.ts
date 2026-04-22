import { assertEquals } from "jsr:@std/assert";
import type { ChatTimelineEntry } from "../../../views/chat/chat-types.ts";
import type { ChatRunMetaMap } from "../../../views/chat/chat-types.ts";

const { buildActiveRunActivityGroups, buildPersistentRunActivityGroups } =
  await import("../../../views/chat/run-activity.ts");

function entry(
  runId: string,
  seq: number,
  type: ChatTimelineEntry["type"],
  message: string,
): ChatTimelineEntry {
  return {
    key: `${runId}:${seq}`,
    seq,
    runId,
    type,
    message,
    createdAt: 1_000 + seq,
  };
}

Deno.test("buildPersistentRunActivityGroups - keeps saved thinking for terminal runs", () => {
  const groups = buildPersistentRunActivityGroups(
    [
      entry("run-1", 1, "thinking", "Reading context"),
      entry("run-1", 2, "progress", "Starting model"),
      entry("run-1", 3, "message", "done"),
      entry("run-1", 4, "completed", "Run completed"),
    ],
    {
      "run-1": {
        runId: "run-1",
        parentRunId: null,
        agentType: "default",
        status: "completed",
      },
    } satisfies ChatRunMetaMap,
  );

  assertEquals(groups.length, 1);
  assertEquals(groups[0].entries.map((item) => item.message), [
    "Reading context",
    "Starting model",
  ]);
});

Deno.test("buildPersistentRunActivityGroups - hides active runs to avoid duplicating live thinking", () => {
  const groups = buildPersistentRunActivityGroups(
    [entry("run-1", 1, "thinking", "Working")],
    {
      "run-1": {
        runId: "run-1",
        parentRunId: null,
        agentType: "default",
        status: "running",
      },
    },
  );

  assertEquals(groups, []);
});

Deno.test("buildActiveRunActivityGroups - restores saved thinking for active runs", () => {
  const groups = buildActiveRunActivityGroups(
    [
      entry("run-1", 1, "thinking", "Reading context"),
      entry("run-1", 2, "tool_call", "Tool call: file_read"),
    ],
    {
      "run-1": {
        runId: "run-1",
        parentRunId: null,
        agentType: "default",
        status: "running",
      },
    },
  );

  assertEquals(groups.length, 1);
  assertEquals(groups[0].status, "running");
  assertEquals(groups[0].entries.map((item) => item.message), [
    "Reading context",
    "Tool call: file_read",
  ]);
});

Deno.test("buildPersistentRunActivityGroups - derives terminal status from saved events", () => {
  const groups = buildPersistentRunActivityGroups(
    [
      entry("run-1", 1, "thinking", "Working"),
      entry("run-1", 2, "run.failed", "Run failed"),
    ],
    {},
  );

  assertEquals(groups.length, 1);
  assertEquals(groups[0].status, "failed");
  assertEquals(groups[0].entries.map((item) => item.type), [
    "thinking",
    "run.failed",
  ]);
});
