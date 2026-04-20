import {
  capabilityFamiliesHandler,
  capabilityInvokeHandler,
  capabilitySearchHandler,
} from "@/tools/custom/discovery";
import { CapabilityRegistry } from "@/tools/capability-registry";
import type { CapabilityDescriptor } from "@/tools/capability-types";
import type { ToolContext } from "@/tools/types";

import {
  assert,
  assertEquals,
  assertRejects,
  assertStringIncludes,
} from "jsr:@std/assert";

function makeDescriptor(
  overrides: Partial<CapabilityDescriptor> & { id: string; name: string },
): CapabilityDescriptor {
  return {
    kind: "tool",
    namespace: "file",
    summary: "A test tool",
    tags: [],
    risk_level: "none",
    side_effects: false,
    source: "custom",
    discoverable: true,
    selectable: true,
    ...overrides,
  };
}

function makeContext(registry?: CapabilityRegistry): ToolContext {
  return { capabilityRegistry: registry } as unknown as ToolContext;
}

let registry: CapabilityRegistry;
let ctx: ToolContext;

Deno.test("discovery tools - capability_search - returns matching results for a query", async () => {
  registry = new CapabilityRegistry();
  registry.register(makeDescriptor({
    id: "tool:file_read",
    name: "file_read",
    summary: "Read file contents",
    tags: ["file", "read"],
    family: "file.ops",
  }));
  registry.register(makeDescriptor({
    id: "tool:web_fetch",
    name: "web_fetch",
    namespace: "web",
    summary: "Fetch a URL",
    tags: ["web"],
    family: "web.fetch",
  }));
  ctx = makeContext(registry);
  const result = JSON.parse(
    await capabilitySearchHandler({ query: "file read" }, ctx),
  );
  assertEquals(result.results.length, 1);
  assertEquals(result.results[0].name, "file_read");
});
Deno.test("discovery tools - capability_search - respects limit parameter", async () => {
  registry = new CapabilityRegistry();
  registry.register(makeDescriptor({
    id: "tool:file_read",
    name: "file_read",
    summary: "Read file contents",
    tags: ["file", "read"],
    family: "file.ops",
  }));
  registry.register(makeDescriptor({
    id: "tool:web_fetch",
    name: "web_fetch",
    namespace: "web",
    summary: "Fetch a URL",
    tags: ["web"],
    family: "web.fetch",
  }));
  ctx = makeContext(registry);
  const result = JSON.parse(
    await capabilitySearchHandler({ query: "file web", limit: 1 }, ctx),
  );
  assertEquals(result.results.length, 1);
});
Deno.test("discovery tools - capability_search - filters out non-discoverable entries", async () => {
  registry = new CapabilityRegistry();
  registry.register(makeDescriptor({
    id: "tool:file_read",
    name: "file_read",
    summary: "Read file contents",
    tags: ["file", "read"],
    family: "file.ops",
  }));
  registry.register(makeDescriptor({
    id: "tool:web_fetch",
    name: "web_fetch",
    namespace: "web",
    summary: "Fetch a URL",
    tags: ["web"],
    family: "web.fetch",
  }));
  ctx = makeContext(registry);
  registry.register(makeDescriptor({
    id: "tool:hidden",
    name: "hidden_tool",
    summary: "Hidden from discovery",
    tags: ["hidden"],
    discoverable: false,
    selectable: false,
  }));

  const result = JSON.parse(
    await capabilitySearchHandler({ query: "hidden", limit: 10 }, ctx),
  );
  assertEquals(
    result.results.every((r: { name: string }) => r.name !== "hidden_tool"),
    true,
  );
});
Deno.test("discovery tools - capability_search - returns total_available count", async () => {
  registry = new CapabilityRegistry();
  registry.register(makeDescriptor({
    id: "tool:file_read",
    name: "file_read",
    summary: "Read file contents",
    tags: ["file", "read"],
    family: "file.ops",
  }));
  registry.register(makeDescriptor({
    id: "tool:web_fetch",
    name: "web_fetch",
    namespace: "web",
    summary: "Fetch a URL",
    tags: ["web"],
    family: "web.fetch",
  }));
  ctx = makeContext(registry);
  const result = JSON.parse(
    await capabilitySearchHandler({ query: "file" }, ctx),
  );
  assertEquals(result.total_available, registry.size);
});
Deno.test("discovery tools - capability_search - returns guidance when registry not attached", async () => {
  registry = new CapabilityRegistry();
  registry.register(makeDescriptor({
    id: "tool:file_read",
    name: "file_read",
    summary: "Read file contents",
    tags: ["file", "read"],
    family: "file.ops",
  }));
  registry.register(makeDescriptor({
    id: "tool:web_fetch",
    name: "web_fetch",
    namespace: "web",
    summary: "Fetch a URL",
    tags: ["web"],
    family: "web.fetch",
  }));
  ctx = makeContext(registry);
  const bareCtx = makeContext(undefined);
  const result = JSON.parse(
    await capabilitySearchHandler({ query: "test" }, bareCtx),
  );
  assertStringIncludes(result.error, "already available");
});

Deno.test("discovery tools - capability_families - returns family list with counts", async () => {
  registry = new CapabilityRegistry();
  registry.register(makeDescriptor({
    id: "tool:file_read",
    name: "file_read",
    summary: "Read file contents",
    tags: ["file", "read"],
    family: "file.ops",
  }));
  registry.register(makeDescriptor({
    id: "tool:web_fetch",
    name: "web_fetch",
    namespace: "web",
    summary: "Fetch a URL",
    tags: ["web"],
    family: "web.fetch",
  }));
  ctx = makeContext(registry);
  const result = JSON.parse(await capabilityFamiliesHandler({}, ctx));
  assert(
    result.families.some((item: any) =>
      JSON.stringify(item) === JSON.stringify({ family: "file.ops", count: 1 })
    ),
  );
  assert(
    result.families.some((item: any) =>
      JSON.stringify(item) ===
        JSON.stringify({ family: "web.fetch", count: 1 })
    ),
  );
  assertEquals(result.total_capabilities, 2);
});
Deno.test("discovery tools - capability_families - returns guidance when registry not attached", async () => {
  registry = new CapabilityRegistry();
  registry.register(makeDescriptor({
    id: "tool:file_read",
    name: "file_read",
    summary: "Read file contents",
    tags: ["file", "read"],
    family: "file.ops",
  }));
  registry.register(makeDescriptor({
    id: "tool:web_fetch",
    name: "web_fetch",
    namespace: "web",
    summary: "Fetch a URL",
    tags: ["web"],
    family: "web.fetch",
  }));
  ctx = makeContext(registry);
  const bareCtx = makeContext(undefined);
  const result = JSON.parse(await capabilityFamiliesHandler({}, bareCtx));
  assertStringIncludes(result.error, "already available");
});

Deno.test("discovery tools - per-run isolation - different contexts have different registries", async () => {
  registry = new CapabilityRegistry();
  registry.register(makeDescriptor({
    id: "tool:file_read",
    name: "file_read",
    summary: "Read file contents",
    tags: ["file", "read"],
    family: "file.ops",
  }));
  registry.register(makeDescriptor({
    id: "tool:web_fetch",
    name: "web_fetch",
    namespace: "web",
    summary: "Fetch a URL",
    tags: ["web"],
    family: "web.fetch",
  }));
  ctx = makeContext(registry);
  const registry2 = new CapabilityRegistry();
  registry2.register(makeDescriptor({
    id: "tool:only_in_ctx2",
    name: "only_in_ctx2",
    summary: "Only in ctx2",
    tags: ["ctx2"],
  }));
  const ctx2 = makeContext(registry2);

  // ctx1 should not see ctx2's tool
  const r1 = JSON.parse(await capabilitySearchHandler({ query: "ctx2" }, ctx));
  assertEquals(r1.results.length, 0);

  // ctx2 should see its own tool
  const r2 = JSON.parse(await capabilitySearchHandler({ query: "ctx2" }, ctx2));
  assertEquals(r2.results.length, 1);
  assertEquals(r2.results[0].name, "only_in_ctx2");
});

Deno.test("discovery tools - capability_invoke - throws when tool_name is missing", async () => {
  registry = new CapabilityRegistry();
  registry.register(makeDescriptor({
    id: "tool:file_read",
    name: "file_read",
    summary: "Read file contents",
    tags: ["file", "read"],
    family: "file.ops",
  }));
  registry.register(makeDescriptor({
    id: "tool:web_fetch",
    name: "web_fetch",
    namespace: "web",
    summary: "Fetch a URL",
    tags: ["web"],
    family: "web.fetch",
  }));
  ctx = makeContext(registry);
  await assertRejects(async () => {
    await capabilityInvokeHandler({}, ctx);
  }, "tool_name is required");
});
Deno.test("discovery tools - capability_invoke - throws when executor is not available", async () => {
  registry = new CapabilityRegistry();
  registry.register(makeDescriptor({
    id: "tool:file_read",
    name: "file_read",
    summary: "Read file contents",
    tags: ["file", "read"],
    family: "file.ops",
  }));
  registry.register(makeDescriptor({
    id: "tool:web_fetch",
    name: "web_fetch",
    namespace: "web",
    summary: "Fetch a URL",
    tags: ["web"],
    family: "web.fetch",
  }));
  ctx = makeContext(registry);
  await assertRejects(async () => {
    await capabilityInvokeHandler({ tool_name: "file_read" }, ctx);
  }, "Tool executor not available");
});
Deno.test("discovery tools - capability_invoke - executes a tool via injected executor", async () => {
  registry = new CapabilityRegistry();
  registry.register(makeDescriptor({
    id: "tool:file_read",
    name: "file_read",
    summary: "Read file contents",
    tags: ["file", "read"],
    family: "file.ops",
  }));
  registry.register(makeDescriptor({
    id: "tool:web_fetch",
    name: "web_fetch",
    namespace: "web",
    summary: "Fetch a URL",
    tags: ["web"],
    family: "web.fetch",
  }));
  ctx = makeContext(registry);
  const mockExecutor = {
    execute: async (call: { name: string }) => ({
      output: `executed ${call.name}`,
    }),
  };
  const ctxWithExecutor = {
    ...ctx,
    _toolExecutor: mockExecutor,
  } as unknown as ToolContext;

  const result = await capabilityInvokeHandler(
    { tool_name: "file_read", arguments: { path: "/test" } },
    ctxWithExecutor,
  );
  assertEquals(result, "executed file_read");
});
Deno.test("discovery tools - capability_invoke - throws on executor error (visible to LangGraph error tracking)", async () => {
  registry = new CapabilityRegistry();
  registry.register(makeDescriptor({
    id: "tool:file_read",
    name: "file_read",
    summary: "Read file contents",
    tags: ["file", "read"],
    family: "file.ops",
  }));
  registry.register(makeDescriptor({
    id: "tool:web_fetch",
    name: "web_fetch",
    namespace: "web",
    summary: "Fetch a URL",
    tags: ["web"],
    family: "web.fetch",
  }));
  ctx = makeContext(registry);
  const mockExecutor = {
    execute: async () => ({
      output: "",
      error: "Unknown tool: nonexistent",
    }),
  };
  const ctxWithExecutor = {
    ...ctx,
    _toolExecutor: mockExecutor,
  } as unknown as ToolContext;

  await assertRejects(async () => {
    await capabilityInvokeHandler(
      { tool_name: "nonexistent" },
      ctxWithExecutor,
    );
  }, "Unknown tool");
});
Deno.test("discovery tools - capability_invoke - blocks invocation of non-discoverable tools (policy gate)", async () => {
  registry = new CapabilityRegistry();
  registry.register(makeDescriptor({
    id: "tool:file_read",
    name: "file_read",
    summary: "Read file contents",
    tags: ["file", "read"],
    family: "file.ops",
  }));
  registry.register(makeDescriptor({
    id: "tool:web_fetch",
    name: "web_fetch",
    namespace: "web",
    summary: "Fetch a URL",
    tags: ["web"],
    family: "web.fetch",
  }));
  ctx = makeContext(registry);
  // Add a tool that is NOT discoverable
  registry.register(makeDescriptor({
    id: "tool:deploy_frontend",
    name: "deploy_frontend",
    discoverable: false,
    selectable: false,
  }));

  const mockExecutor = {
    execute: async (call: { name: string }) => ({
      output: `executed ${call.name}`,
    }),
  };
  const ctxWithExecutor = {
    ...ctx,
    _toolExecutor: mockExecutor,
  } as unknown as ToolContext;

  await assertRejects(async () => {
    await capabilityInvokeHandler(
      { tool_name: "deploy_frontend" },
      ctxWithExecutor,
    );
  }, "not available for invocation");
});
Deno.test("discovery tools - capability_invoke - blocks self-invocation to prevent recursion", async () => {
  registry = new CapabilityRegistry();
  registry.register(makeDescriptor({
    id: "tool:file_read",
    name: "file_read",
    summary: "Read file contents",
    tags: ["file", "read"],
    family: "file.ops",
  }));
  registry.register(makeDescriptor({
    id: "tool:web_fetch",
    name: "web_fetch",
    namespace: "web",
    summary: "Fetch a URL",
    tags: ["web"],
    family: "web.fetch",
  }));
  ctx = makeContext(registry);
  const mockExecutor = {
    execute: async (call: { name: string }) => ({
      output: `executed ${call.name}`,
    }),
  };
  const ctxWithExecutor = {
    ...ctx,
    _toolExecutor: mockExecutor,
  } as unknown as ToolContext;

  await assertRejects(async () => {
    await capabilityInvokeHandler(
      { tool_name: "capability_invoke" },
      ctxWithExecutor,
    );
  }, "cannot invoke itself");
});
Deno.test("discovery tools - capability_invoke - allows invocation of discoverable tools", async () => {
  registry = new CapabilityRegistry();
  registry.register(makeDescriptor({
    id: "tool:file_read",
    name: "file_read",
    summary: "Read file contents",
    tags: ["file", "read"],
    family: "file.ops",
  }));
  registry.register(makeDescriptor({
    id: "tool:web_fetch",
    name: "web_fetch",
    namespace: "web",
    summary: "Fetch a URL",
    tags: ["web"],
    family: "web.fetch",
  }));
  ctx = makeContext(registry);
  // web_fetch is discoverable (default policy)
  const mockExecutor = {
    execute: async (call: { name: string }) => ({
      output: `executed ${call.name}`,
    }),
  };
  const ctxWithExecutor = {
    ...ctx,
    _toolExecutor: mockExecutor,
  } as unknown as ToolContext;

  const result = await capabilityInvokeHandler(
    { tool_name: "web_fetch", arguments: {} },
    ctxWithExecutor,
  );
  assertEquals(result, "executed web_fetch");
});
