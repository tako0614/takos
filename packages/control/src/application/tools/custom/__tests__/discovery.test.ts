import {
  assertEquals,
  assertRejects,
  assertStringIncludes,
} from "jsr:@std/assert";

import { CapabilityRegistry } from "../../capability-registry.ts";
import type { CapabilityDescriptor } from "../../capability-types.ts";
import type { ToolContext, ToolDefinition } from "../../tool-definitions.ts";
import { capabilityDescribeHandler, toolboxHandler } from "../discovery.ts";

Deno.test("toolbox search hides router tools and points agents back to toolbox", async () => {
  const registry = new CapabilityRegistry();
  registry.registerAll(
    [
      {
        id: "tool:toolbox",
        kind: "tool",
        namespace: "discovery",
        name: "toolbox",
        summary: "Tool router.",
        tags: ["discovery"],
        family: "discovery.toolbox",
        risk_level: "medium",
        side_effects: true,
        source: "custom",
        discoverable: true,
        selectable: true,
      },
      {
        id: "skill:research-brief",
        kind: "skill",
        namespace: "web",
        name: "Research Brief",
        summary: "Research workflow manual.",
        instructions: "Gather facts before concluding.",
        tags: ["research", "sources"],
        triggers: ["research"],
        family: "skill.research",
        risk_level: "none",
        side_effects: false,
        source: "managed_skill",
        discoverable: true,
        selectable: false,
      },
      {
        id: "tool:sheet_create",
        kind: "tool",
        namespace: "mcp",
        name: "sheet_create",
        summary: "Create a spreadsheet.",
        tags: ["mcp", "mcp.excel-mcp", "sheet"],
        family: "mcp.excel-mcp",
        risk_level: "low",
        side_effects: true,
        source: "mcp",
        discoverable: true,
        selectable: true,
      },
    ] satisfies CapabilityDescriptor[],
  );

  const output = JSON.parse(
    await toolboxHandler(
      { action: "search", query: "spreadsheet research", limit: 3 },
      { capabilityRegistry: registry } as ToolContext,
    ),
  );

  assertEquals(
    output.results.some((result: { name: string }) =>
      result.name === "sheet_create"
    ),
    true,
  );
  assertEquals(
    output.results.some((result: { kind: string }) => result.kind === "manual"),
    true,
  );
  assertEquals(
    output.results.some((result: { name: string }) =>
      result.name === "toolbox"
    ),
    false,
  );
  assertStringIncludes(output.hint, "toolbox action=describe");
  assertStringIncludes(output.hint, "action=call");
});

Deno.test("toolbox describe returns manual instructions for skill descriptors", async () => {
  const registry = new CapabilityRegistry();
  registry.register({
    id: "skill:research-brief",
    kind: "skill",
    namespace: "web",
    name: "Research Brief",
    summary: "Research workflow manual.",
    instructions: "Gather facts before concluding.",
    recommended_tools: ["web_fetch"],
    output_modes: ["chat"],
    durable_output_hints: ["artifact"],
    tags: ["research"],
    triggers: ["research"],
    family: "skill.research",
    risk_level: "none",
    side_effects: false,
    source: "managed_skill",
    discoverable: true,
    selectable: false,
  });

  const output = JSON.parse(
    await toolboxHandler(
      { action: "describe", tool_name: "research-brief" },
      {
        capabilityRegistry: registry,
        _toolExecutor: {
          getAvailableTools: () => [],
          execute: async () => ({ output: "" }),
        },
      } as unknown as ToolContext,
    ),
  );

  assertEquals(output.tools, []);
  assertEquals(output.manuals[0].kind, "manual");
  assertEquals(output.manuals[0].recommended_tools, ["web_fetch"]);
  assertStringIncludes(output.manuals[0].instructions, "Gather facts");
});

Deno.test("toolbox describe returns full schemas for discovered tools", async () => {
  const tools: ToolDefinition[] = [
    {
      name: "slide_create",
      description: "Create a slide deck.",
      category: "mcp",
      namespace: "mcp",
      family: "mcp.slide-mcp",
      risk_level: "low",
      side_effects: true,
      parameters: {
        type: "object",
        properties: {
          title: {
            type: "string",
            description: "Slide deck title.",
          },
        },
        required: ["title"],
      },
    },
  ];

  const output = JSON.parse(
    await toolboxHandler(
      { action: "describe", tool_names: ["slide_create", "missing_tool"] },
      {
        _toolExecutor: {
          getAvailableTools: () => tools,
          execute: async () => ({ output: "" }),
        },
      } as unknown as ToolContext,
    ),
  );

  assertEquals(output.tools[0].name, "slide_create");
  assertEquals(output.tools[0].available, true);
  assertEquals(output.tools[0].parameters.required, ["title"]);
  assertEquals(output.tools[1], { name: "missing_tool", available: false });
  assertStringIncludes(output.hint, "toolbox action=call");
});

Deno.test("toolbox call executes non-router tools", async () => {
  const calls: Array<{ name: string; arguments: Record<string, unknown> }> = [];

  const output = await toolboxHandler(
    {
      action: "call",
      tool_name: "slide_create",
      arguments: { title: "Quarterly Review" },
    },
    {
      _toolExecutor: {
        getAvailableTools: () => [{
          name: "slide_create",
          description: "Create a slide deck.",
          category: "mcp",
          parameters: { type: "object", properties: {} },
        }],
        execute: async (
          call: { name: string; arguments: Record<string, unknown> },
        ) => {
          calls.push({ name: call.name, arguments: call.arguments });
          return { output: JSON.stringify({ ok: true }) };
        },
      },
    } as unknown as ToolContext,
  );

  assertEquals(JSON.parse(output), { ok: true });
  assertEquals(calls, [
    { name: "slide_create", arguments: { title: "Quarterly Review" } },
  ]);
});

Deno.test("toolbox call rejects tools outside the available catalog", async () => {
  await assertRejects(
    () =>
      toolboxHandler(
        {
          action: "call",
          tool_name: "missing_tool",
          arguments: {},
        },
        {
          _toolExecutor: {
            getAvailableTools: () => [],
            execute: async () => ({ output: "" }),
          },
        } as unknown as ToolContext,
      ),
    Error,
    "not in the available tool catalog",
  );
});

Deno.test("toolbox call rejects tools missing capability descriptors when registry is attached", async () => {
  const registry = new CapabilityRegistry();
  await assertRejects(
    () =>
      toolboxHandler(
        {
          action: "call",
          tool_name: "slide_create",
          arguments: {},
        },
        {
          capabilityRegistry: registry,
          _toolExecutor: {
            getAvailableTools: () => [{
              name: "slide_create",
              description: "Create a slide deck.",
              category: "mcp",
              parameters: { type: "object", properties: {} },
            }],
            execute: async () => ({ output: "" }),
          },
        } as unknown as ToolContext,
      ),
    Error,
    "missing a capability descriptor",
  );
});

Deno.test("capability aliases delegate to toolbox behavior", async () => {
  const tools: ToolDefinition[] = [
    {
      name: "slide_create",
      description: "Create a slide deck.",
      category: "mcp",
      parameters: {
        type: "object",
        properties: {
          title: { type: "string", description: "Slide deck title." },
        },
      },
    },
  ];

  const output = JSON.parse(
    await capabilityDescribeHandler(
      { tool_name: "slide_create" },
      {
        _toolExecutor: {
          getAvailableTools: () => tools,
          execute: async () => ({ output: "" }),
        },
      } as unknown as ToolContext,
    ),
  );

  assertEquals(output.tools[0].name, "slide_create");
});
