import { test } from "bun:test";
import { assertEquals, assertRejects, assertStringIncludes } from "@takos/test/assert";

import { CapabilityRegistry } from "../../capability-registry.ts";
import type { CapabilityDescriptor } from "../../capability-types.ts";
import type { ToolContext, ToolDefinition } from "../../tool-definitions.ts";
import { toolboxHandler } from "../discovery.ts";

test("toolbox search hides router tools and points agents back to toolbox", async () => {
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
        id: "skill:managed:research-brief",
        kind: "skill",
        namespace: "web",
        name: "Research Brief",
        summary: "Research workflow manual.",
        tags: ["research", "sources"],
        triggers: ["research"],
        family: "skill.research",
        risk_level: "none",
        side_effects: false,
        source: "managed_skill",
        discoverable: true,
        selectable: false,
        manual_identity: {
          source: "managed",
          skill_id: "research-brief",
        },
        availability: "available",
        availability_reasons: [],
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

test("toolbox describe activates exact pinned manual instructions", async () => {
  const registry = new CapabilityRegistry();
  registry.register({
    id: "skill:managed:research-brief",
    kind: "skill",
    namespace: "web",
    name: "Research Brief",
    summary: "Research workflow manual.",
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
    manual_identity: {
      source: "managed",
      skill_id: "research-brief",
    },
    availability: "available",
    availability_reasons: [],
    resource_manifest: [{
      id: "research-brief",
      title: "Research brief template",
      description: "Evidence structure.",
      mediaType: "text/markdown",
      byteSize: 18,
      digest: `sha256:${"a".repeat(64)}`,
    }],
  });
  const activations: unknown[] = [];

  const output = JSON.parse(
    await toolboxHandler(
      { action: "describe", tool_name: "research-brief" },
      {
        capabilityRegistry: registry,
        toolCallId: "tool_call_manual_1",
        _activateSkillManuals: async (manuals: unknown, toolCallId: string) => {
          activations.push({ manuals, toolCallId });
          return [{
            skill: {
              id: "research-brief",
              source: "managed",
              instructions: "Gather facts before concluding.",
            },
            resourceManifest: [{
              id: "research-brief",
              title: "Research brief template",
              description: "Evidence structure.",
              mediaType: "text/markdown",
              byteSize: 18,
              digest: `sha256:${"a".repeat(64)}`,
            }],
          }];
        },
        _toolExecutor: {
          getAvailableTools: () => [],
          execute: async () => ({ output: "" }),
        },
      } as unknown as ToolContext,
    ),
  );

  assertEquals(output.tools, []);
  assertEquals(output.manuals[0].kind, "manual");
  assertEquals(output.manuals[0].activated, true);
  assertEquals(output.manuals[0].recommended_tools, ["web_fetch"]);
  assertEquals(output.manuals[0].resource_manifest[0].id, "research-brief");
  assertStringIncludes(output.manuals[0].instructions, "Gather facts");
  assertEquals(activations, [{
    manuals: [{ source: "managed", skillId: "research-brief" }],
    toolCallId: "tool_call_manual_1",
  }]);
});

test("toolbox describe reads one exact resource after manual activation", async () => {
  const registry = new CapabilityRegistry();
  registry.register({
    id: "skill:managed:research-brief",
    kind: "skill",
    namespace: "web",
    name: "Research Brief",
    summary: "Research workflow manual.",
    tags: ["research"],
    family: "skill.research",
    risk_level: "none",
    side_effects: false,
    source: "managed_skill",
    discoverable: true,
    selectable: false,
    manual_identity: { source: "managed", skill_id: "research-brief" },
    availability: "available",
    availability_reasons: [],
    resource_manifest: [{
      id: "research-brief",
      title: "Research brief template",
      description: "Evidence structure.",
      mediaType: "text/markdown",
      byteSize: 18,
      digest: `sha256:${"a".repeat(64)}`,
    }],
  });
  const activations: unknown[] = [];
  const output = JSON.parse(await toolboxHandler(
    {
      action: "describe",
      tool_name: "skill:managed:research-brief",
      resource_id: "research-brief",
    },
    {
      capabilityRegistry: registry,
      toolCallId: "tool_call_resource_1",
      _activateSkillResource: async (resource: unknown, toolCallId: string) => {
        activations.push({ resource, toolCallId });
        return {
          manual: { source: "managed", skillId: "research-brief" },
          id: "research-brief",
          title: "Research brief template",
          description: "Evidence structure.",
          mediaType: "text/markdown",
          byteSize: 18,
          digest: `sha256:${"a".repeat(64)}`,
          content: "# Research brief\n",
        };
      },
      _toolExecutor: {
        getAvailableTools: () => [],
        execute: async () => ({ output: "" }),
      },
    } as unknown as ToolContext,
  ));
  assertEquals(output.manual.id, "skill:managed:research-brief");
  assertEquals(output.resource.activated, true);
  assertEquals(output.resource.content, "# Research brief\n");
  assertEquals(activations, [{
    resource: {
      source: "managed",
      skillId: "research-brief",
      resourceId: "research-brief",
    },
    toolCallId: "tool_call_resource_1",
  }]);
});

test("toolbox describe never exposes unavailable or ambiguous manual content", async () => {
  const registry = new CapabilityRegistry();
  registry.registerAll([
    {
      id: "skill:managed:shared",
      kind: "skill",
      namespace: "web",
      name: "Managed Shared",
      summary: "Needs a removed server.",
      tags: ["shared"],
      family: "skill.research",
      risk_level: "none",
      side_effects: false,
      source: "managed_skill",
      discoverable: true,
      selectable: false,
      manual_identity: { source: "managed", skill_id: "shared" },
      availability: "unavailable",
      availability_reasons: ["missing required MCP servers: private"],
    },
    {
      id: "skill:custom:shared",
      kind: "skill",
      namespace: "discovery",
      name: "Custom Shared",
      summary: "Custom manual with the same logical name.",
      tags: ["shared"],
      family: "skill.custom",
      risk_level: "none",
      side_effects: false,
      source: "custom_skill",
      discoverable: true,
      selectable: false,
      manual_identity: { source: "custom", skill_id: "shared" },
      availability: "available",
      availability_reasons: [],
    },
  ]);
  const unavailable = JSON.parse(await toolboxHandler(
    { action: "describe", tool_name: "skill:managed:shared" },
    {
      capabilityRegistry: registry,
      _toolExecutor: {
        getAvailableTools: () => [],
        execute: async () => ({ output: "" }),
      },
    } as unknown as ToolContext,
  ));
  assertEquals(unavailable.manuals[0].activated, false);
  assertEquals(unavailable.manuals[0].instructions, undefined);
  assertStringIncludes(
    unavailable.manuals[0].availability_reasons[0],
    "missing required MCP",
  );

  await assertRejects(
    () =>
      toolboxHandler(
        { action: "describe", tool_name: "shared" },
        {
          capabilityRegistry: registry,
          _toolExecutor: {
            getAvailableTools: () => [],
            execute: async () => ({ output: "" }),
          },
        } as unknown as ToolContext,
      ),
    Error,
    "ambiguous",
  );
});

test("toolbox describe returns full schemas for discovered tools", async () => {
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
        toolCallId: "describe-tools",
        _activateToolDescriptors: async (names: readonly string[]) =>
          names.map((name, index) => ({
            revisionId: `revision-${index}`,
            reference: {
              resourceKind: "tool_descriptor_revision",
              resourceId: `tooldescriptor_${String(index).padStart(64, "0")}`,
              resourceDigest: `sha256:${String(index).padStart(64, "0")}`,
            },
            snapshot: {
              logicalName: name,
              definition: tools.find((tool) => tool.name === name),
            },
          })) as never,
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

test("toolbox call executes non-router tools under the outer call identity", async () => {
  const calls: Array<{
    id: string;
    name: string;
    arguments: Record<string, unknown>;
  }> = [];

  const output = await toolboxHandler(
    {
      action: "call",
      tool_name: "slide_create",
      arguments: { title: "Quarterly Review" },
    },
    {
      toolCallId: "call-slide-create",
      _activateToolDescriptors: async () => [{
        revisionId: "revision-slide-create",
        reference: {
          resourceKind: "tool_descriptor_revision",
          resourceId: `tooldescriptor_${"a".repeat(64)}`,
          resourceDigest: `sha256:${"b".repeat(64)}`,
        },
        snapshot: {
          logicalName: "slide_create",
          definition: {
            name: "slide_create",
            description: "Create a slide deck.",
            category: "mcp",
            risk_level: "low",
            side_effects: true,
            parameters: { type: "object", properties: {} },
          },
        },
      }] as never,
      _toolExecutor: {
        getAvailableTools: () => [{
          name: "slide_create",
          description: "Create a slide deck.",
          category: "mcp",
          parameters: { type: "object", properties: {} },
        }],
        execute: async (
          call: {
            id: string;
            name: string;
            arguments: Record<string, unknown>;
          },
        ) => {
          calls.push({
            id: call.id,
            name: call.name,
            arguments: call.arguments,
          });
          return { output: JSON.stringify({ ok: true }) };
        },
      },
    } as unknown as ToolContext,
  );

  assertEquals(JSON.parse(output), { ok: true });
  assertEquals(calls, [
    {
      id: "call-slide-create",
      name: "slide_create",
      arguments: { title: "Quarterly Review" },
    },
  ]);
});

test("toolbox call rejects tools outside the available catalog", async () => {
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

test("toolbox call rejects tools missing capability descriptors when registry is attached", async () => {
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
