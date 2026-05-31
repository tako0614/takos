import type { ToolContext } from "@/tools/types";
import type { Env } from "@/types";

import { assertEquals } from "@std/assert";

import { memoryGraphRecallHandler } from "@/tools/custom/memory-graph";
import { noopSqlDatabaseBinding } from "@test/binding-stubs";
import { noopDep } from "@test/dep-stubs";

function createMockContext(): ToolContext {
  return {
    spaceId: "space1",
    threadId: "thread1",
    runId: "run1",
    userId: "user1",
    capabilities: [],
    env: {} as Env,
    db: noopSqlDatabaseBinding(),
    setSessionId: noopDep<ToolContext["setSessionId"]>("setSessionId"),
    getLastContainerStartFailure: () => undefined,
    setLastContainerStartFailure: noopDep<
      ToolContext["setLastContainerStartFailure"]
    >("setLastContainerStartFailure"),
  };
}

Deno.test("memory_graph_recall handler - path_search mode requires claim_id", async () => {
  const result = await memoryGraphRecallHandler(
    { query: "test", mode: "path_search" },
    createMockContext(),
  );
  assertEquals(result, "claim_id is required for path_search mode");
});

Deno.test("memory_graph_recall handler - evidence mode requires claim_id", async () => {
  const result = await memoryGraphRecallHandler(
    { query: "test", mode: "evidence" },
    createMockContext(),
  );
  assertEquals(result, "claim_id is required for evidence mode");
});
