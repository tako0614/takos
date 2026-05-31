import type { ToolContext, ToolDefinition } from "@/tools/types";
import type { Env } from "@/types";
import type { CapabilityDescriptor } from "@/tools/capability-types";
import { CapabilityRegistry } from "@/tools/capability-registry";

import {
  CAPABILITY_DESCRIBE,
  CAPABILITY_FAMILIES,
  CAPABILITY_INVOKE,
  CAPABILITY_SEARCH,
  capabilityFamiliesHandler,
  capabilityInvokeHandler,
  capabilitySearchHandler,
  DISCOVERY_HANDLERS,
  DISCOVERY_TOOLS,
  TOOLBOX,
} from "@/tools/custom/discovery";

import {
  assert,
  assertEquals,
  assertRejects,
  assertStringIncludes,
} from "@std/assert";
import { noopSqlDatabaseBinding } from "@test/binding-stubs";
import { noopDep } from "@test/dep-stubs";

/**
 * Build a CapabilityRegistry with selected method overrides. Methods not
 * overridden retain their real implementations (which operate on an empty
 * descriptor map).
 */
function fakeRegistry(
  overrides: Partial<CapabilityRegistry>,
): CapabilityRegistry {
  return Object.assign(new CapabilityRegistry(), overrides);
}

function descriptor(
  overrides: Partial<CapabilityDescriptor> & {
    id: string;
    name: string;
  },
): CapabilityDescriptor {
  return {
    kind: "tool",
    namespace: "file",
    summary: "",
    tags: [],
    risk_level: "none",
    side_effects: false,
    source: "custom",
    discoverable: true,
    selectable: true,
    ...overrides,
  };
}

function makeContext(overrides: Partial<ToolContext> = {}): ToolContext {
  return {
    spaceId: "ws-test",
    threadId: "thread-1",
    runId: "run-1",
    userId: "user-1",
    capabilities: [],
    env: {} as Env,
    db: noopSqlDatabaseBinding(),
    setSessionId: noopDep<ToolContext["setSessionId"]>("setSessionId"),
    getLastContainerStartFailure: () => undefined,
    setLastContainerStartFailure: noopDep<
      ToolContext["setLastContainerStartFailure"]
    >("setLastContainerStartFailure"),
    ...overrides,
  };
}

Deno.test("discovery tool definitions - defines router tools", () => {
  assertEquals(DISCOVERY_TOOLS.length, 5);
  assertEquals(DISCOVERY_TOOLS.map((t) => t.name), [
    "toolbox",
    "capability_search",
    "capability_families",
    "capability_describe",
    "capability_invoke",
  ]);
});

Deno.test("discovery tool definitions - all tools have space category", () => {
  for (const def of DISCOVERY_TOOLS) {
    assertEquals(def.category, "space");
  }
});

Deno.test("discovery tool definitions - DISCOVERY_HANDLERS maps all tools", () => {
  for (const def of DISCOVERY_TOOLS) {
    assert(def.name in DISCOVERY_HANDLERS);
  }
});

Deno.test("discovery tool definitions - parameter contracts are stable", () => {
  assertEquals(CAPABILITY_SEARCH.parameters.required, ["query"]);
  assertEquals(CAPABILITY_FAMILIES.parameters.required, undefined);
  assertEquals(CAPABILITY_DESCRIBE.parameters.required, undefined);
  assertEquals(CAPABILITY_INVOKE.parameters.required, ["tool_name"]);
  assertEquals(TOOLBOX.parameters.required, ["action"]);
});

Deno.test("capabilitySearchHandler - returns error when no registry is available", async () => {
  const result = JSON.parse(
    await capabilitySearchHandler(
      { query: "test" },
      makeContext({ capabilityRegistry: undefined }),
    ),
  );
  assertStringIncludes(result.error, "All tools are already available");
});

Deno.test("capabilitySearchHandler - searches registry and returns discoverable results", async () => {
  const descriptors: CapabilityDescriptor[] = [
    descriptor({
      id: "tool:file_read",
      name: "file_read",
      summary: "Read a file",
      family: "file",
      risk_level: "low",
      discoverable: true,
    }),
    descriptor({
      id: "tool:secret_tool",
      name: "secret_tool",
      summary: "Hidden tool",
      family: "internal",
      risk_level: "high",
      discoverable: false,
    }),
  ];
  const capabilityRegistry = fakeRegistry({
    search: () => descriptors,
    families: () => [],
    get: () => undefined,
    all: () => descriptors,
  });

  const result = JSON.parse(
    await capabilitySearchHandler(
      { query: "file" },
      makeContext({ capabilityRegistry }),
    ),
  );

  assertEquals(result.results.length, 1);
  assertEquals(result.results[0].name, "file_read");
  assertEquals(result.total_available, 1);
  assertStringIncludes(result.hint, "toolbox action=describe");
});

Deno.test("capabilitySearchHandler - uses custom limit", async () => {
  const calls: Array<[string, { limit?: number } | undefined]> = [];
  const capabilityRegistry = fakeRegistry({
    search: (query: string, opts?: { limit?: number }) => {
      calls.push([query, opts]);
      return [];
    },
    families: () => [],
    get: () => undefined,
    all: () => [],
  });

  await capabilitySearchHandler(
    { query: "test", limit: 5 },
    makeContext({ capabilityRegistry }),
  );
  assertEquals(calls, [["test", { limit: 10 }]]);
});

Deno.test("capabilitySearchHandler - defaults limit to 10", async () => {
  const calls: Array<[string, { limit?: number } | undefined]> = [];
  const capabilityRegistry = fakeRegistry({
    search: (query: string, opts?: { limit?: number }) => {
      calls.push([query, opts]);
      return [];
    },
    families: () => [],
    get: () => undefined,
    all: () => [],
  });

  await capabilitySearchHandler(
    { query: "test" },
    makeContext({ capabilityRegistry }),
  );
  assertEquals(calls, [["test", { limit: 15 }]]);
});

Deno.test("capabilityFamiliesHandler - returns error when no registry is available", async () => {
  const result = JSON.parse(
    await capabilityFamiliesHandler(
      {},
      makeContext({ capabilityRegistry: undefined }),
    ),
  );
  assertStringIncludes(result.error, "All tools are already available");
});

Deno.test("capabilityFamiliesHandler - returns families and total count", async () => {
  const capabilityRegistry = fakeRegistry({
    search: () => [],
    families: () => [],
    get: () => undefined,
    all: () => [
      descriptor({
        id: "tool:file_read",
        name: "file_read",
        summary: "Read a file",
        family: "file",
        risk_level: "low",
        discoverable: true,
      }),
      descriptor({
        id: "tool:kv_get",
        name: "kv_get",
        summary: "Read kv store",
        family: "storage",
        namespace: "storage",
        discoverable: true,
      }),
    ],
  });

  const result = JSON.parse(
    await capabilityFamiliesHandler(
      {},
      makeContext({ capabilityRegistry }),
    ),
  );
  assertEquals(result.families.length, 2);
  assertEquals(result.families[0].family, "file");
  assertEquals(result.total_capabilities, 2);
});

Deno.test("capabilityInvokeHandler - throws when tool_name is empty", async () => {
  const ctx = makeContext({
    capabilityRegistry: fakeRegistry({ get: () => undefined }),
  });
  await assertRejects(async () => {
    await capabilityInvokeHandler({ tool_name: "" }, ctx);
  }, "tool_name is required");
});

Deno.test("capabilityInvokeHandler - throws when trying to invoke itself", async () => {
  const ctx = makeContext({
    capabilityRegistry: fakeRegistry({ get: () => undefined }),
  });
  await assertRejects(async () => {
    await capabilityInvokeHandler({ tool_name: "capability_invoke" }, ctx);
  }, "cannot invoke router tool");
});

Deno.test("capabilityInvokeHandler - throws when tool is not discoverable", async () => {
  const capabilityRegistry = fakeRegistry({
    get: () =>
      descriptor({
        id: "tool:secret_tool",
        name: "secret_tool",
        discoverable: false,
      }),
  });
  await assertRejects(async () => {
    await capabilityInvokeHandler(
      { tool_name: "secret_tool" },
      makeContext({ capabilityRegistry }),
    );
  }, "not available for invocation");
});

Deno.test("capabilityInvokeHandler - throws when tool executor is not available", async () => {
  const capabilityRegistry = fakeRegistry({
    get: () =>
      descriptor({
        id: "tool:file_read",
        name: "file_read",
        kind: "tool",
        discoverable: true,
        selectable: true,
      }),
  });
  await assertRejects(async () => {
    await capabilityInvokeHandler(
      { tool_name: "file_read" },
      makeContext({ capabilityRegistry }),
    );
  }, "Tool executor not available");
});

Deno.test("capabilityInvokeHandler - executes a tool and returns output", async () => {
  const capabilityRegistry = fakeRegistry({
    get: () =>
      descriptor({
        id: "tool:file_read",
        name: "file_read",
        kind: "tool",
        discoverable: true,
        selectable: true,
      }),
  });
  const baseCtx = makeContext({ capabilityRegistry });
  const toolDef: ToolDefinition = {
    name: "file_read",
    description: "Read a file",
    category: "file",
    parameters: { type: "object", properties: {} },
  };
  const ctx: ToolContext & {
    _toolExecutor: {
      getAvailableTools: () => ToolDefinition[];
      execute: () => Promise<{ output: string }>;
    };
  } = {
    ...baseCtx,
    _toolExecutor: {
      getAvailableTools: () => [toolDef],
      execute: () => Promise.resolve({ output: "file content here" }),
    },
  };

  const result = await capabilityInvokeHandler(
    { tool_name: "file_read", arguments: { path: "test.ts" } },
    ctx,
  );

  assertStringIncludes(result, "file content here");
});
