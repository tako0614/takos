import {
  applyPolicyForRole,
  buildCustomSkillDescriptor,
  buildMcpToolDescriptor,
  buildSkillDescriptor,
  buildToolDescriptor,
} from "@/tools/descriptor-builder";
import { BUILTIN_TOOLS } from "@/tools/builtin";

import { assert, assertEquals } from "jsr:@std/assert";

Deno.test("descriptor-builder - buildToolDescriptor - converts a builtin tool to a descriptor", () => {
  const fileRead = BUILTIN_TOOLS.find((t) => t.name === "file_read")!;
  const descriptor = buildToolDescriptor(fileRead);

  assertEquals(descriptor.id, "tool:file_read");
  assertEquals(descriptor.kind, "tool");
  assertEquals(descriptor.namespace, "file");
  assertEquals(descriptor.name, "file_read");
  assertEquals(descriptor.summary, fileRead.description);
  assertEquals(descriptor.risk_level, "none");
  assertEquals(descriptor.side_effects, false);
  assertEquals(descriptor.source, "builtin");
  assertEquals(descriptor.discoverable, true);
  assertEquals(descriptor.selectable, true);
});
Deno.test("descriptor-builder - buildToolDescriptor - includes family from namespace map", () => {
  const containerStart = BUILTIN_TOOLS.find((t) =>
    t.name === "container_start"
  )!;
  const descriptor = buildToolDescriptor(containerStart);

  assertEquals(descriptor.family, "container.lifecycle");
});
Deno.test("descriptor-builder - buildToolDescriptor - includes required_capabilities if present", () => {
  const webFetch = BUILTIN_TOOLS.find((t) => t.name === "web_fetch")!;
  const descriptor = buildToolDescriptor(webFetch);

  assert(descriptor.tags !== undefined);
});

Deno.test("descriptor-builder - buildSkillDescriptor - converts an official skill to a descriptor", () => {
  const descriptor = buildSkillDescriptor({
    id: "research-brief",
    version: "1.0.0",
    locale: "en",
    category: "research",
    priority: 100,
    activation_tags: ["research"],
    execution_contract: {
      preferred_tools: [],
      durable_output_hints: [],
      output_modes: [],
      required_mcp_servers: [],
      template_ids: [],
    },
    name: "Research Brief",
    description: "Investigate a topic.",
    instructions: "Gather facts.",
    triggers: ["research", "investigate"],
  });

  assertEquals(descriptor.id, "skill:research-brief");
  assertEquals(descriptor.kind, "skill");
  assertEquals(descriptor.namespace, "web");
  assertEquals(descriptor.source, "official_skill");
  assertEquals(descriptor.triggers, ["research", "investigate"]);
});

Deno.test("descriptor-builder - buildCustomSkillDescriptor - converts a custom skill row to a descriptor", () => {
  const descriptor = buildCustomSkillDescriptor({
    id: "my-skill",
    name: "My Skill",
    description: "A custom skill.",
    triggers: ["custom", "test"],
    category: "research",
  });

  assertEquals(descriptor.id, "skill:my-skill");
  assertEquals(descriptor.kind, "skill");
  assertEquals(descriptor.source, "custom_skill");
});
Deno.test("descriptor-builder - buildCustomSkillDescriptor - handles missing fields gracefully", () => {
  const descriptor = buildCustomSkillDescriptor({
    id: "minimal",
    name: "Minimal",
    description: "No triggers or category.",
  });

  assertEquals(descriptor.triggers, []);
  assertEquals(descriptor.family, "skill.custom");
});

Deno.test("descriptor-builder - buildMcpToolDescriptor - creates a descriptor with server metadata", () => {
  const descriptor = buildMcpToolDescriptor(
    {
      name: "my_tool",
      description: "A tool from my-server.",
      category: "mcp",
      parameters: { type: "object", properties: {} },
    },
    { serverName: "my-server", sourceType: "external" },
  );

  assertEquals(descriptor.id, "tool:my_tool");
  assertEquals(descriptor.namespace, "mcp");
  assertEquals(descriptor.source, "mcp");
  assertEquals(descriptor.family, "mcp.my-server");
  assertEquals(descriptor.risk_level, "medium");
  assertEquals(descriptor.tags.includes("mcp.my-server"), true);
});
Deno.test("descriptor-builder - buildMcpToolDescriptor - sets lower risk for managed MCP servers", () => {
  const descriptor = buildMcpToolDescriptor(
    {
      name: "managed_tool",
      description: "A managed MCP tool.",
      category: "mcp",
      parameters: { type: "object", properties: {} },
    },
    { serverName: "my-worker", sourceType: "managed" },
  );

  assertEquals(descriptor.risk_level, "low");
  assertEquals(descriptor.family, "mcp.my-worker");
});
Deno.test("descriptor-builder - buildMcpToolDescriptor - infers server name from namespaced tool name", () => {
  const descriptor = buildMcpToolDescriptor({
    name: "github__list_repos",
    description: "List repos.",
    category: "mcp",
    parameters: { type: "object", properties: {} },
  });

  assertEquals(descriptor.family, "mcp.github");
});
Deno.test("descriptor-builder - buildMcpToolDescriptor - falls back to mcp.external for plain tool names", () => {
  const descriptor = buildMcpToolDescriptor({
    name: "plain_tool",
    description: "No server prefix.",
    category: "mcp",
    parameters: { type: "object", properties: {} },
  });

  assertEquals(descriptor.family, "mcp.external");
});

Deno.test("descriptor-builder - applyPolicyForRole - hides high-risk tools from viewers", () => {
  const descriptors = [
    buildToolDescriptor(
      BUILTIN_TOOLS.find((t) => t.name === "deploy_frontend")!,
    ),
    buildToolDescriptor(BUILTIN_TOOLS.find((t) => t.name === "file_read")!),
  ];

  const result = applyPolicyForRole(descriptors, "viewer");
  const deploy = result.find((d) => d.name === "deploy_frontend")!;
  const fileRead = result.find((d) => d.name === "file_read")!;

  assertEquals(deploy.discoverable, false);
  assertEquals(deploy.selectable, false);
  assertEquals(fileRead.discoverable, true);
  assertEquals(fileRead.selectable, true);
});
Deno.test("descriptor-builder - applyPolicyForRole - restricts web/browser tools without egress.http capability", () => {
  const descriptors = [
    buildToolDescriptor(BUILTIN_TOOLS.find((t) => t.name === "web_fetch")!),
    buildToolDescriptor(BUILTIN_TOOLS.find((t) => t.name === "file_read")!),
  ];

  const result = applyPolicyForRole(descriptors, "editor", []);
  const webFetch = result.find((d) => d.name === "web_fetch")!;
  const fileRead = result.find((d) => d.name === "file_read")!;

  assertEquals(webFetch.selectable, false);
  assertEquals(fileRead.selectable, true);
});
