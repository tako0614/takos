import type { ToolContext } from "@/tools/types";
import type { D1Database } from "@cloudflare/workers-types";
import type { Env } from "@/types";

import {
  INFO_UNIT_HANDLERS,
  INFO_UNIT_SEARCH,
  INFO_UNIT_TOOLS,
  infoUnitSearchHandler,
  REPO_GRAPH_LINEAGE,
  REPO_GRAPH_NEIGHBORS,
  REPO_GRAPH_SEARCH,
  repoGraphLineageHandler,
  repoGraphNeighborsHandler,
  repoGraphSearchHandler,
} from "@/tools/custom/info-unit";

import {
  assert,
  assertEquals,
  assertRejects,
  assertStringIncludes,
} from "jsr:@std/assert";

function makeContext(overrides: Partial<ToolContext> = {}): ToolContext {
  return {
    spaceId: "ws-test",
    threadId: "thread-1",
    runId: "run-1",
    userId: "user-1",
    capabilities: [],
    env: {} as Env,
    db: {} as D1Database,
    setSessionId: ((..._args: any[]) => undefined) as any,
    getLastContainerStartFailure: () => undefined,
    setLastContainerStartFailure: ((..._args: any[]) => undefined) as any,
    ...overrides,
  };
}

Deno.test("info unit tool definitions - defines all four info unit tools", () => {
  assertEquals(INFO_UNIT_TOOLS.length, 4);
  assertEquals(INFO_UNIT_TOOLS.map((t) => t.name), [
    "info_unit_search",
    "repo_graph_search",
    "repo_graph_neighbors",
    "repo_graph_lineage",
  ]);
});

Deno.test("info unit tool definitions - all tools have memory category", () => {
  for (const def of INFO_UNIT_TOOLS) {
    assertEquals(def.category, "memory");
  }
});

Deno.test("info unit tool definitions - parameter contracts are stable", () => {
  assertEquals(INFO_UNIT_SEARCH.parameters.required, ["query"]);
  assertEquals(REPO_GRAPH_SEARCH.parameters.required, ["query"]);
  assertEquals(REPO_GRAPH_NEIGHBORS.parameters.required, []);
  assertEquals(REPO_GRAPH_LINEAGE.parameters.required, ["info_unit_id"]);
});

Deno.test("info unit tool definitions - INFO_UNIT_HANDLERS maps all tools", () => {
  const keys = Object.keys(INFO_UNIT_HANDLERS);
  assertEquals(keys.length, 4);
  for (const def of INFO_UNIT_TOOLS) {
    assert(def.name in INFO_UNIT_HANDLERS);
  }
});

Deno.test("infoUnitSearchHandler - throws when query is empty", async () => {
  await assertRejects(async () => {
    await infoUnitSearchHandler({ query: "" }, makeContext());
  }, "Query is required");
});

Deno.test("infoUnitSearchHandler - throws when query is whitespace only", async () => {
  await assertRejects(async () => {
    await infoUnitSearchHandler({ query: "   " }, makeContext());
  }, "Query is required");
});

Deno.test("repoGraphSearchHandler - throws when query is empty", async () => {
  await assertRejects(async () => {
    await repoGraphSearchHandler({ query: "" }, makeContext());
  }, "Query is required");
});

Deno.test("repoGraphNeighborsHandler - throws when info_unit_id is empty", async () => {
  await assertRejects(async () => {
    await repoGraphNeighborsHandler({ info_unit_id: "" }, makeContext());
  }, "info_unit_id is required");
});

Deno.test("repoGraphLineageHandler - throws when info_unit_id is empty", async () => {
  await assertRejects(async () => {
    await repoGraphLineageHandler({ info_unit_id: "" }, makeContext());
  }, "info_unit_id is required");
});

Deno.test("info unit validation result strings remain stable", async () => {
  const queryError = await infoUnitSearchHandler({ query: "" }, makeContext())
    .catch((err) => String(err));
  assertStringIncludes(queryError, "Query is required");
});
