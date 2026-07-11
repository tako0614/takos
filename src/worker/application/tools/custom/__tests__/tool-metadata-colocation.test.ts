import { test } from "bun:test";
import { assert, assertEquals } from "@takos/test/assert";

import { CUSTOM_TOOLS } from "../registry.ts";
import {
  getToolPolicyMetadata,
  validateCustomToolPolicies,
} from "../../tool-policy.ts";
import { buildToolDescriptor } from "../../descriptor-builder.ts";

// After the namespace-map / CUSTOM_TOOL_POLICY_METADATA side-tables were
// retired, every tool's namespace / family / risk / policy metadata is authored
// directly on its ToolDefinition literal. These guards lock in that contract so
// a tool can never silently lose its co-located metadata again.

test("every custom tool carries co-located namespace metadata", () => {
  for (const tool of CUSTOM_TOOLS) {
    assert(
      tool.namespace !== undefined,
      `tool "${tool.name}" is missing namespace`,
    );
    assert(tool.family !== undefined, `tool "${tool.name}" is missing family`);
    assert(
      tool.risk_level !== undefined,
      `tool "${tool.name}" is missing risk_level`,
    );
    assert(
      tool.side_effects !== undefined,
      `tool "${tool.name}" is missing side_effects`,
    );
  }
});

test("space_mapped tools declare a valid operation_id", () => {
  const errors = validateCustomToolPolicies(CUSTOM_TOOLS);
  assertEquals(errors, [], errors.join("\n"));

  for (const tool of CUSTOM_TOOLS) {
    const metadata = getToolPolicyMetadata(tool);
    if (metadata.tool_class === "space_mapped") {
      assert(
        metadata.operation_id !== undefined,
        `space_mapped tool "${tool.name}" is missing operation_id`,
      );
    }
  }
});

test("descriptor metadata is derived from the tool's own fields", () => {
  for (const tool of CUSTOM_TOOLS) {
    const descriptor = buildToolDescriptor(tool);
    assertEquals(
      descriptor.namespace,
      tool.namespace,
      `descriptor namespace drift for "${tool.name}"`,
    );
    assertEquals(
      descriptor.family,
      tool.family,
      `descriptor family drift for "${tool.name}"`,
    );
    assertEquals(
      descriptor.risk_level,
      tool.risk_level,
      `descriptor risk_level drift for "${tool.name}"`,
    );
    assertEquals(
      descriptor.side_effects,
      tool.side_effects,
      `descriptor side_effects drift for "${tool.name}"`,
    );
  }
});

test("network tools carry their egress capability on the definition", () => {
  for (const name of ["web_fetch", "mcp_add_server"]) {
    const tool = CUSTOM_TOOLS.find((candidate) => candidate.name === name);
    assert(tool !== undefined, `missing tool "${name}"`);
    assertEquals(tool.required_capabilities, ["egress.http"]);
  }
});
