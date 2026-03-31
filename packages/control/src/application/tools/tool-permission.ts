/**
 * Permission checks for tool execution.
 *
 * Centralises role-based access control and capability gating that was
 * previously inlined in ToolExecutor.
 */

import type { ToolContext, ToolDefinition } from './tool-definitions.ts';
import { canRoleAccessTool, filterToolsForRole } from './tool-policy.ts';
import { getRequiredCapabilitiesForTool } from './capabilities.ts';
import { ToolError, ErrorCodes } from './tool-error-classifier.ts';

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

/** Merge static capability mapping with per-definition required_capabilities. */
export function getAllRequiredCapabilities(tool: { name: string; required_capabilities?: string[] }): string[] {
  return Array.from(new Set([
    ...getRequiredCapabilitiesForTool(tool.name),
    ...(tool.required_capabilities || []),
  ]));
}

/** Check whether the caller's role satisfies the tool's `required_roles` list. */
export function canRoleAccessExposedTool(
  role: ToolContext['role'],
  tool: { required_roles?: string[] },
): boolean {
  if (!tool.required_roles || tool.required_roles.length === 0) {
    return true;
  }
  if (!role) {
    return false;
  }
  return tool.required_roles.includes(role);
}

/** Check whether the granted capabilities cover all that the tool requires. */
export function canUseToolCapabilities(
  capabilities: readonly string[],
  tool: { name: string; required_capabilities?: string[] },
): boolean {
  const granted = new Set(capabilities);
  return getAllRequiredCapabilities(tool).every((cap) => granted.has(cap));
}

// ---------------------------------------------------------------------------
// Composite check used during execution
// ---------------------------------------------------------------------------

/**
 * Run all permission checks for a single tool call.
 *
 * Throws a `ToolError` with `ErrorCodes.PERMISSION_DENIED` when access is not
 * allowed. Returns normally when the call is permitted.
 */
export function assertToolPermission(
  toolName: string,
  toolDefinition: ToolDefinition,
  context: Pick<ToolContext, 'role' | 'capabilities'>,
): void {
  if (context.role && !canRoleAccessTool(context.role, toolDefinition)) {
    throw new ToolError(
      `Permission denied for tool "${toolName}": workspace role "${context.role}" cannot use this workspace operation`,
      ErrorCodes.PERMISSION_DENIED
    );
  }

  if (!canRoleAccessExposedTool(context.role, toolDefinition)) {
    throw new ToolError(
      `Permission denied for tool "${toolName}": workspace role "${context.role}" is not allowed`,
      ErrorCodes.PERMISSION_DENIED
    );
  }

  const requiredCapabilities = getAllRequiredCapabilities(toolDefinition);
  if (requiredCapabilities.length > 0) {
    const granted = new Set(context.capabilities || []);
    const missing = requiredCapabilities.filter((cap) => !granted.has(cap));
    if (missing.length > 0) {
      throw new ToolError(
        `Permission denied for tool "${toolName}": missing capabilities: ${missing.join(', ')}`,
        ErrorCodes.PERMISSION_DENIED
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Filtering for getAvailableTools
// ---------------------------------------------------------------------------

/** Return only the tools accessible to the given role and capabilities. */
export function filterAccessibleTools(
  tools: ToolDefinition[],
  role: ToolContext['role'],
  capabilities: readonly string[],
): ToolDefinition[] {
  return filterToolsForRole(tools, role)
    .filter((tool) => canRoleAccessExposedTool(role, tool))
    .filter((tool) => canUseToolCapabilities(capabilities, tool));
}
