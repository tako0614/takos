import type { ToolContext } from "@/tools/types";
import type { D1Database } from "@cloudflare/workers-types";
import type { Env } from "@/types";

// ---------------------------------------------------------------------------
// Drizzle-chainable mock
// ---------------------------------------------------------------------------

import {
  assert,
  assertEquals,
  assertRejects,
  assertStringIncludes,
} from "jsr:@std/assert";
import { assertSpyCallArgs } from "jsr:@std/testing/mock";

const mockSelectGet = ((..._args: any[]) => undefined) as any;
const mockSelectAll = ((..._args: any[]) => undefined) as any;

// [Deno] vi.mock removed - manually stub imports from '@/db'
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
} from "@/tools/builtin/info-unit";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

function makeContextWithAI(): ToolContext {
  return makeContext({
    env: {
      AI: {
        run: async () => ({ data: [[0.1, 0.2, 0.3]] }),
      },
      VECTORIZE: {
        query: async () => ({
          matches: [
            {
              score: 0.9,
              metadata: {
                content: "TypeScript is preferred",
                runId: "run-1",
                segmentIndex: 0,
                segmentCount: 1,
              },
            },
            {
              score: 0.3, // Below default threshold
              metadata: { content: "Low score result" },
            },
          ],
        }),
      },
    } as unknown as Env,
  });
}

// ---------------------------------------------------------------------------
// Tool definitions
// ---------------------------------------------------------------------------

Deno.test("info unit tool definitions - defines all four info unit tools", () => {
  assertEquals(INFO_UNIT_TOOLS.length, 4);
  const names = INFO_UNIT_TOOLS.map((t) => t.name);
  assertEquals(names, [
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
Deno.test("info unit tool definitions - info_unit_search requires query", () => {
  assertEquals(INFO_UNIT_SEARCH.parameters.required, ["query"]);
});
Deno.test("info unit tool definitions - repo_graph_search requires query", () => {
  assertEquals(REPO_GRAPH_SEARCH.parameters.required, ["query"]);
});
Deno.test("info unit tool definitions - repo_graph_neighbors has no required params", () => {
  assertEquals(REPO_GRAPH_NEIGHBORS.parameters.required, []);
});
Deno.test("info unit tool definitions - repo_graph_lineage requires info_unit_id", () => {
  assertEquals(REPO_GRAPH_LINEAGE.parameters.required, ["info_unit_id"]);
});
Deno.test("info unit tool definitions - INFO_UNIT_HANDLERS maps all tools", () => {
  const keys = Object.keys(INFO_UNIT_HANDLERS);
  assertEquals(keys.length, 4);
  for (const def of INFO_UNIT_TOOLS) {
    assert(def.name in INFO_UNIT_HANDLERS);
  }
});
// ---------------------------------------------------------------------------
// infoUnitSearchHandler
// ---------------------------------------------------------------------------

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
Deno.test("infoUnitSearchHandler - uses vector search when AI and VECTORIZE are available", async () => {
  const ctx = makeContextWithAI();

  const result = await infoUnitSearchHandler({ query: "TypeScript" }, ctx);

  assertStringIncludes(result, "Found 1 info units");
  assertStringIncludes(result, "TypeScript is preferred");
  assertStringIncludes(result, "0.900");
  assertStringIncludes(result, "run:run-1");
});
Deno.test("infoUnitSearchHandler - returns no results message when vector search has no matches above threshold", async () => {
  const ctx = makeContext({
    env: {
      AI: {
        run: async () => ({ data: [[0.1, 0.2]] }),
      },
      VECTORIZE: {
        query: async () => ({
          matches: [{ score: 0.3, metadata: { content: "low" } }],
        }),
      },
    } as unknown as Env,
  });

  const result = await infoUnitSearchHandler({ query: "nothing here" }, ctx);
  assertStringIncludes(result, "No info units found");
});
Deno.test("infoUnitSearchHandler - handles embedding failure", async () => {
  const ctx = makeContext({
    env: {
      AI: { run: async () => ({ data: [] }) },
      VECTORIZE: { query: ((..._args: any[]) => undefined) as any },
    } as unknown as Env,
  });

  const result = await infoUnitSearchHandler({ query: "test" }, ctx);
  assertStringIncludes(result, "embedding failed");
});
Deno.test("infoUnitSearchHandler - falls back to text search when AI is not available", async () => {
  mockSelectAll = (async () => [
    {
      id: "u1",
      runId: "run-1",
      kind: "summary",
      content: "Matching content",
      createdAt: "2026-01-01",
    },
  ]) as any;

  const result = await infoUnitSearchHandler(
    { query: "Matching" },
    makeContext(),
  );

  assertStringIncludes(result, "Found 1 info units");
  assertStringIncludes(result, "run:run-1");
  assertStringIncludes(result, "Matching content");
});
Deno.test("infoUnitSearchHandler - reports no results in text search fallback", async () => {
  mockSelectAll = (async () => []) as any;

  const result = await infoUnitSearchHandler(
    { query: "nothing" },
    makeContext(),
  );
  assertStringIncludes(result, "No info units found");
});
Deno.test("infoUnitSearchHandler - respects custom limit and min_score", async () => {
  const ctx = makeContextWithAI();

  await infoUnitSearchHandler({ query: "test", limit: 2, min_score: 0.8 }, ctx);

  assertSpyCallArgs((ctx.env.VECTORIZE as any).query, 0, [
    /* expect.any(Array) */ {} as any,
    { topK: 4 },
  ]);
});
// ---------------------------------------------------------------------------
// repoGraphSearchHandler
// ---------------------------------------------------------------------------

Deno.test("repoGraphSearchHandler - throws when query is empty", async () => {
  await assertRejects(async () => {
    await repoGraphSearchHandler({ query: "" }, makeContext());
  }, "Query is required");
});
Deno.test("repoGraphSearchHandler - rejects unauthorized repo access", async () => {
  mockSelectAll = (async () => []) as any; // resolveAccessibleRepoIds finds no owned repos

  await assertRejects(async () => {
    await repoGraphSearchHandler(
      { query: "test", repo_ids: ["unauthorized-repo"] },
      makeContext(),
    );
  }, "Repository access denied");
});
Deno.test("repoGraphSearchHandler - falls back to text search without AI", async () => {
  // resolveAccessibleRepoIds short-circuits when repo_ids is empty, so only
  // the main text-search query calls .all()
  mockSelectAll = (async () => [
    {
      id: "u1",
      runId: "r1",
      kind: "summary",
      content: "Test content",
      createdAt: "2026-01-01",
      metadata: "{}",
    },
  ]) as any;

  const result = await repoGraphSearchHandler({ query: "Test" }, makeContext());
  assertStringIncludes(result, "Found 1 info units");
});
// ---------------------------------------------------------------------------
// repoGraphNeighborsHandler
// ---------------------------------------------------------------------------

Deno.test("repoGraphNeighborsHandler - throws when neither node_id nor info_unit_id is provided", async () => {
  mockSelectGet = (async () => undefined) as any;

  await assertRejects(async () => {
    await repoGraphNeighborsHandler({}, makeContext());
  }, "node_id or info_unit_id is required");
});
Deno.test("repoGraphNeighborsHandler - returns no neighbors message when none found", async () => {
  mockSelectAll = (async () => []) as any;

  const result = await repoGraphNeighborsHandler(
    { node_id: "node-1" },
    makeContext(),
  );
  assertEquals(result, "No neighboring nodes found.");
});
Deno.test("repoGraphNeighborsHandler - resolves info_unit_id to node_id", async () => {
  mockSelectGet = (async () => ({ id: "resolved-node" })) as any;
  mockSelectAll = (async () => []) as any;

  const result = await repoGraphNeighborsHandler(
    { info_unit_id: "iu-1" },
    makeContext(),
  );
  assertEquals(result, "No neighboring nodes found.");
});
// ---------------------------------------------------------------------------
// repoGraphLineageHandler
// ---------------------------------------------------------------------------

Deno.test("repoGraphLineageHandler - returns not found when info unit node does not exist", async () => {
  mockSelectGet = (async () => null) as any;

  const result = await repoGraphLineageHandler(
    { info_unit_id: "missing" },
    makeContext(),
  );
  assertEquals(result, "Info unit node not found.");
});
Deno.test("repoGraphLineageHandler - returns no lineage message when no edges found", async () => {
  mockSelectGet = (async () => ({ id: "node-1" })) as any;
  mockSelectAll = (async () => []) as any;

  const result = await repoGraphLineageHandler(
    { info_unit_id: "iu-1" },
    makeContext(),
  );
  assertEquals(result, "No lineage edges found.");
});
