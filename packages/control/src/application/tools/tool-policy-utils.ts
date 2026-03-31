import type { SpaceRole } from '../../shared/types/index.ts';
import type { ToolDefinition } from './tool-definitions.ts';
import type {
  ToolClass,
  SpaceOperationId,
  SpaceOperationPolicy,
} from './tool-policy-types.ts';
import {
  SPACE_OPERATION_POLICIES,
  BUILTIN_TOOL_POLICY_METADATA,
  AGENT_DISABLED_TOOL_SET,
  type ToolPolicyMetadata,
} from './tool-policy.ts';
import { TOOL_NAMESPACE_MAP } from './namespace-map.ts';

function inferDefaultToolClass(_toolName: string): ToolClass {
  return 'agent_native';
}

export function getSpaceOperationPolicy(operationId: SpaceOperationId): SpaceOperationPolicy {
  return SPACE_OPERATION_POLICIES[operationId];
}

export function getToolPolicyMetadata(tool: ToolDefinition | string): ToolPolicyMetadata {
  const name = typeof tool === 'string' ? tool : tool.name;
  const registered = BUILTIN_TOOL_POLICY_METADATA[name];

  if (typeof tool === 'string') {
    return registered || {
      tool_class: inferDefaultToolClass(name),
    };
  }

  return {
    tool_class: tool.tool_class ?? registered?.tool_class ?? inferDefaultToolClass(name),
    operation_id: tool.operation_id ?? registered?.operation_id,
    composed_operations: tool.composed_operations ?? registered?.composed_operations,
    sensitive_read_policy: tool.sensitive_read_policy ?? registered?.sensitive_read_policy,
  };
}

export function applyToolPolicyMetadata(tool: ToolDefinition): ToolDefinition {
  const metadata = getToolPolicyMetadata(tool);
  const nsMeta = TOOL_NAMESPACE_MAP[tool.name];
  return {
    ...tool,
    ...metadata,
    sensitive_read_policy: metadata.sensitive_read_policy ?? tool.sensitive_read_policy,
    namespace: tool.namespace ?? nsMeta?.namespace,
    family: tool.family ?? nsMeta?.family,
    risk_level: tool.risk_level ?? nsMeta?.risk_level,
    side_effects: tool.side_effects ?? nsMeta?.side_effects,
  };
}

export function applyBuiltinToolPolicyMetadata(tools: ToolDefinition[]): ToolDefinition[] {
  return tools.map(applyToolPolicyMetadata);
}

export function canRoleAccessOperation(role: SpaceRole, operationId: SpaceOperationId): boolean {
  return getSpaceOperationPolicy(operationId).allowed_roles.includes(role);
}

export function canRoleAccessTool(role: SpaceRole, tool: ToolDefinition): boolean {
  const metadata = getToolPolicyMetadata(tool);

  if (metadata.tool_class === 'workspace_mapped') {
    if (!metadata.operation_id) return false;
    return canRoleAccessOperation(role, metadata.operation_id);
  }

  if (metadata.tool_class === 'composite') {
    return (metadata.composed_operations || []).every((operationId) => canRoleAccessOperation(role, operationId));
  }

  return true;
}

export function filterToolsForRole(tools: ToolDefinition[], role?: SpaceRole): ToolDefinition[] {
  if (!role) return tools;
  return tools.filter((tool) => canRoleAccessTool(role, tool));
}

export function isToolAllowedForAgent(toolName: string): boolean {
  return !AGENT_DISABLED_TOOL_SET.has(toolName);
}

export function filterAgentAllowedToolNames(toolNames: readonly string[]): string[] {
  return toolNames.filter(isToolAllowedForAgent);
}

export function validateBuiltinToolPolicies(tools: readonly ToolDefinition[]): string[] {
  const errors: string[] = [];
  const toolNames = new Set(tools.map((tool) => tool.name));

  for (const tool of tools) {
    const metadata = getToolPolicyMetadata(tool);
    if (metadata.tool_class === 'workspace_mapped' && !metadata.operation_id) {
      errors.push(`Tool "${tool.name}" is workspace_mapped but has no operation_id`);
    }
    if (metadata.tool_class === 'workspace_mapped' && metadata.operation_id && !(metadata.operation_id in SPACE_OPERATION_POLICIES)) {
      errors.push(`Tool "${tool.name}" references unknown operation "${metadata.operation_id}"`);
    }
  }

  return errors;
}
