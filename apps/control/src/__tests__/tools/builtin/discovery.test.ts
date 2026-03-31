import type { ToolContext } from "@/tools/types";
import type { D1Database } from "@cloudflare/workers-types";
import type { Env } from "@/types";

import {
  CAPABILITY_FAMILIES,
  CAPABILITY_INVOKE,
  CAPABILITY_SEARCH,
  capabilityFamiliesHandler,
  capabilityInvokeHandler,
  capabilitySearchHandler,
  DISCOVERY_HANDLERS,
  DISCOVERY_TOOLS,
} from "@/tools/builtin/discovery";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

import {
  assert,
  assertEquals,
  assertRejects,
  assertStringIncludes,
} from "jsr:@std/assert";
import { assertSpyCallArgs } from "jsr:@std/testing/mock";

const mockRegistry = {
  search: ((..._args: any[]) => undefined) as any,
  families: ((..._args: any[]) => undefined) as any,
  get: ((..._args: any[]) => undefined) as any,
  size: 42,
};

const mockExecutor = {
  execute: ((..._args: any[]) => undefined) as any,
};

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
    capabilityRegistry: mockRegistry as any,
    ...overrides,
  };
}

function makeContextWithExecutor(
  overrides: Partial<ToolContext> = {},
): ToolContext {
  const ctx = makeContext(overrides) as any;
  ctx._toolExecutor = mockExecutor;
  return ctx;
}

// ---------------------------------------------------------------------------
// Tool definitions
// ---------------------------------------------------------------------------

Deno.test("discovery tool definitions - defines three tools", () => {
  assertEquals(DISCOVERY_TOOLS.length, 3);
  const names = DISCOVERY_TOOLS.map((t) => t.name);
  assertStringIncludes(names, "capability_search");
  assertStringIncludes(names, "capability_families");
  assertStringIncludes(names, "capability_invoke");
});
Deno.test("discovery tool definitions - all tools have workspace category", () => {
  for (const def of DISCOVERY_TOOLS) {
    assertEquals(def.category, "workspace");
  }
});
Deno.test("discovery tool definitions - DISCOVERY_HANDLERS maps all tools", () => {
  for (const def of DISCOVERY_TOOLS) {
    assert(def.name in DISCOVERY_HANDLERS);
  }
});
Deno.test("discovery tool definitions - capability_search requires query", () => {
  assertEquals(CAPABILITY_SEARCH.parameters.required, ["query"]);
});
Deno.test("discovery tool definitions - capability_families has no required params", () => {
  assertEquals(CAPABILITY_FAMILIES.parameters.required, undefined);
});
Deno.test("discovery tool definitions - capability_invoke requires tool_name", () => {
  assertEquals(CAPABILITY_INVOKE.parameters.required, ["tool_name"]);
});
// ---------------------------------------------------------------------------
// capabilitySearchHandler
// ---------------------------------------------------------------------------

Deno.test("capabilitySearchHandler - returns error when no registry is available", async () => {
  const ctx = makeContext({ capabilityRegistry: undefined });

  const result = JSON.parse(
    await capabilitySearchHandler({ query: "test" }, ctx),
  );

  assertStringIncludes(result.error, "All tools are already available");
});
Deno.test("capabilitySearchHandler - searches registry and returns discoverable results", async () => {
  mockRegistry.search = (() => [
    {
      id: "tool:file_read",
      kind: "tool",
      name: "file_read",
      summary: "Read a file",
      family: "file",
      namespace: "builtin",
      risk_level: "low",
      discoverable: true,
    },
    {
      id: "tool:secret_tool",
      kind: "tool",
      name: "secret_tool",
      summary: "Hidden tool",
      family: "internal",
      namespace: "builtin",
      risk_level: "high",
      discoverable: false,
    },
  ]) as any;

  const result = JSON.parse(
    await capabilitySearchHandler({ query: "file" }, makeContext()),
  );

  assertEquals(result.results.length, 1);
  assertEquals(result.results[0].name, "file_read");
  assertEquals(result.total_available, 42);
  assertStringIncludes(result.hint, "capability_invoke");
});
Deno.test("capabilitySearchHandler - uses custom limit", async () => {
  mockRegistry.search = (() => []) as any;

  await capabilitySearchHandler({ query: "test", limit: 5 }, makeContext());

  assertSpyCallArgs(mockRegistry.search, 0, ["test", { limit: 5 }]);
});
Deno.test("capabilitySearchHandler - defaults limit to 10", async () => {
  mockRegistry.search = (() => []) as any;

  await capabilitySearchHandler({ query: "test" }, makeContext());

  assertSpyCallArgs(mockRegistry.search, 0, ["test", { limit: 10 }]);
});
// ---------------------------------------------------------------------------
// capabilityFamiliesHandler
// ---------------------------------------------------------------------------

Deno.test("capabilityFamiliesHandler - returns error when no registry is available", async () => {
  const ctx = makeContext({ capabilityRegistry: undefined });

  const result = JSON.parse(await capabilityFamiliesHandler({}, ctx));
  assertStringIncludes(result.error, "All tools are already available");
});
Deno.test("capabilityFamiliesHandler - returns families and total count", async () => {
  mockRegistry.families = (() => [
    { family: "file", count: 8 },
    { family: "storage", count: 12 },
  ]) as any;

  const result = JSON.parse(await capabilityFamiliesHandler({}, makeContext()));

  assertEquals(result.families.length, 2);
  assertEquals(result.families[0].family, "file");
  assertEquals(result.total_capabilities, 42);
});
// ---------------------------------------------------------------------------
// capabilityInvokeHandler
// ---------------------------------------------------------------------------

Deno.test("capabilityInvokeHandler - throws when tool_name is empty", async () => {
  await assertRejects(async () => {
    await capabilityInvokeHandler({ tool_name: "" }, makeContextWithExecutor());
  }, "tool_name is required");
});
Deno.test("capabilityInvokeHandler - throws when trying to invoke itself", async () => {
  await assertRejects(async () => {
    await capabilityInvokeHandler(
      { tool_name: "capability_invoke" },
      makeContextWithExecutor(),
    );
  }, "cannot invoke itself");
});
Deno.test("capabilityInvokeHandler - throws when tool is not discoverable", async () => {
  mockRegistry.get = (() => ({ discoverable: false })) as any;

  await assertRejects(async () => {
    await capabilityInvokeHandler(
      { tool_name: "secret_tool" },
      makeContextWithExecutor(),
    );
  }, "not available for invocation");
});
Deno.test("capabilityInvokeHandler - throws when tool executor is not available", async () => {
  const ctx = makeContext(); // no _toolExecutor
  mockRegistry.get = (() => ({ discoverable: true })) as any;

  await assertRejects(async () => {
    await capabilityInvokeHandler({ tool_name: "file_read" }, ctx);
  }, "Tool executor not available");
});
Deno.test("capabilityInvokeHandler - executes a tool and returns output", async () => {
  mockRegistry.get = (() => ({ discoverable: true })) as any;
  mockExecutor.execute = (async () => ({
    output: "file content here",
  })) as any;

  const result = await capabilityInvokeHandler(
    { tool_name: "file_read", arguments: { path: "test.ts" } },
    makeContextWithExecutor(),
  );

  assertEquals(result, "file content here");
  assertSpyCallArgs(mockExecutor.execute, 0, [
    {
      name: "file_read",
      arguments: { path: "test.ts" },
    },
  ]);
});
Deno.test("capabilityInvokeHandler - throws when execution returns an error", async () => {
  mockRegistry.get = (() => ({ discoverable: true })) as any;
  mockExecutor.execute = (async () => ({
    output: "",
    error: "permission denied",
  })) as any;

  await assertRejects(async () => {
    await capabilityInvokeHandler(
      { tool_name: "file_read", arguments: { path: "/etc/shadow" } },
      makeContextWithExecutor(),
    );
  }, "permission denied");
});
Deno.test("capabilityInvokeHandler - handles missing arguments gracefully", async () => {
  mockRegistry.get = (() => ({ discoverable: true })) as any;
  mockExecutor.execute = (async () => ({ output: "ok" })) as any;

  const result = await capabilityInvokeHandler(
    { tool_name: "some_tool" },
    makeContextWithExecutor(),
  );

  assertEquals(result, "ok");
  assertSpyCallArgs(mockExecutor.execute, 0, [
    {
      name: "some_tool",
      arguments: {},
    },
  ]);
});
Deno.test("capabilityInvokeHandler - allows invocation when registry does not have descriptor", async () => {
  mockRegistry.get = (() => undefined) as any; // no descriptor found

  mockExecutor.execute = (async () => ({ output: "result" })) as any;

  const result = await capabilityInvokeHandler(
    { tool_name: "unknown_tool" },
    makeContextWithExecutor(),
  );

  assertEquals(result, "result");
});
Deno.test("capabilityInvokeHandler - allows invocation when no registry is present", async () => {
  const ctx = makeContextWithExecutor({ capabilityRegistry: undefined });
  mockExecutor.execute = (async () => ({ output: "no-reg-result" })) as any;

  const result = await capabilityInvokeHandler(
    { tool_name: "some_tool" },
    ctx,
  );

  assertEquals(result, "no-reg-result");
});
