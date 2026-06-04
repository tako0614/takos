import type { SpaceRole } from "../../shared/types/index.ts";
import type { ToolDefinition } from "./tool-definitions.ts";
import type {
  SpaceOperationId,
  SpaceOperationPolicy,
  ToolClass,
} from "./tool-policy-types.ts";
import {
  AGENT_DISABLED_TOOL_SET,
  SPACE_OPERATION_POLICIES,
  type ToolPolicyMetadata,
} from "./tool-policy.ts";

const DEFAULT_TOOL_CLASS: ToolClass = "agent_native";

export function getSpaceOperationPolicy(
  operationId: SpaceOperationId,
): SpaceOperationPolicy {
  return SPACE_OPERATION_POLICIES[operationId];
}

export function getToolPolicyMetadata(
  tool: ToolDefinition | string,
): ToolPolicyMetadata {
  if (typeof tool === "string") {
    return { tool_class: DEFAULT_TOOL_CLASS };
  }

  return {
    tool_class: tool.tool_class ?? DEFAULT_TOOL_CLASS,
    operation_id: tool.operation_id,
    composed_operations: tool.composed_operations,
    sensitive_read_policy: tool.sensitive_read_policy,
  };
}

/**
 * Normalize a tool definition's policy metadata by applying the tool_class
 * default. All namespace / risk / operation metadata is now authored directly
 * on the ToolDefinition literal, so this only fills in the inferred default.
 */
export function applyToolPolicyMetadata(tool: ToolDefinition): ToolDefinition {
  return {
    ...tool,
    tool_class: tool.tool_class ?? DEFAULT_TOOL_CLASS,
  };
}

export function applyCustomToolPolicyMetadata(
  tools: ToolDefinition[],
): ToolDefinition[] {
  return tools.map(applyToolPolicyMetadata);
}

export function canRoleAccessOperation(
  role: SpaceRole,
  operationId: SpaceOperationId,
): boolean {
  return getSpaceOperationPolicy(operationId).allowed_roles.includes(role);
}

export function canRoleAccessTool(
  role: SpaceRole,
  tool: ToolDefinition,
): boolean {
  const metadata = getToolPolicyMetadata(tool);

  if (metadata.tool_class === "space_mapped") {
    if (!metadata.operation_id) return false;
    return canRoleAccessOperation(role, metadata.operation_id);
  }

  if (metadata.tool_class === "composite") {
    return (metadata.composed_operations || []).every((operationId) =>
      canRoleAccessOperation(role, operationId)
    );
  }

  return true;
}

export function filterToolsForRole(
  tools: ToolDefinition[],
  role?: SpaceRole,
): ToolDefinition[] {
  if (!role) return tools;
  return tools.filter((tool) => canRoleAccessTool(role, tool));
}

export function isToolAllowedForAgent(toolName: string): boolean {
  return !AGENT_DISABLED_TOOL_SET.has(toolName);
}

export function filterAgentAllowedToolNames(
  toolNames: readonly string[],
): string[] {
  return toolNames.filter(isToolAllowedForAgent);
}

export function validateCustomToolPolicies(
  tools: readonly ToolDefinition[],
): string[] {
  const errors: string[] = [];

  for (const tool of tools) {
    const metadata = getToolPolicyMetadata(tool);
    if (metadata.tool_class === "space_mapped" && !metadata.operation_id) {
      errors.push(
        `Tool "${tool.name}" is space_mapped but has no operation_id`,
      );
    }
    if (
      metadata.tool_class === "space_mapped" && metadata.operation_id &&
      !(metadata.operation_id in SPACE_OPERATION_POLICIES)
    ) {
      errors.push(
        `Tool "${tool.name}" references unknown operation "${metadata.operation_id}"`,
      );
    }
  }

  return errors;
}
