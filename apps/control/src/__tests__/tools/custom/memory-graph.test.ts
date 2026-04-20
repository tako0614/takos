import type { ToolContext } from "@/tools/types";
import type { D1Database } from "@cloudflare/workers-types";
import type { Env } from "@/types";

import { assertEquals } from "jsr:@std/assert";

import { memoryGraphRecallHandler } from "@/tools/custom/memory-graph";

function createMockContext(): ToolContext {
  return {
    spaceId: "space1",
    threadId: "thread1",
    runId: "run1",
    userId: "user1",
    capabilities: [],
    env: {} as Env,
    db: {} as D1Database,
    setSessionId: ((..._args: any[]) => undefined) as any,
    getLastContainerStartFailure: ((..._args: any[]) => undefined) as any,
    setLastContainerStartFailure: ((..._args: any[]) => undefined) as any,
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
