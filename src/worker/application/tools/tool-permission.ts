/**
 * Permission checks for tool execution.
 *
 * Centralises capability gating and compatibility filtering for historical
 * tool-policy tiers. Tiers do not represent Workspace membership authority.
 */

import type { ToolContext, ToolDefinition } from "./tool-definitions.ts";
import {
  canLegacyToolPolicyTierAccessTool,
  filterToolsForLegacyPolicyTier,
} from "./tool-policy.ts";
import { ErrorCodes, ToolError } from "./tool-error-classifier.ts";

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

/** Read the capabilities authored on the tool definition itself. */
export function getAllRequiredCapabilities(tool: {
  required_capabilities?: string[];
}): string[] {
  return Array.from(new Set(tool.required_capabilities || []));
}

/** Apply a historical tool definition's compatibility-tier filter. */
export function canLegacyToolPolicyTierAccessExposedTool(
  policyTier: ToolContext["toolPolicyTier"],
  tool: { required_tool_policy_tiers?: string[] },
): boolean {
  if (
    !tool.required_tool_policy_tiers ||
    tool.required_tool_policy_tiers.length === 0
  ) {
    return true;
  }
  if (!policyTier) {
    return false;
  }
  return tool.required_tool_policy_tiers.includes(policyTier);
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
  context: Pick<ToolContext, "toolPolicyTier" | "capabilities">,
): void {
  if (
    context.toolPolicyTier &&
    !canLegacyToolPolicyTierAccessTool(
      context.toolPolicyTier,
      toolDefinition,
    )
  ) {
    throw new ToolError(
      `Permission denied for tool "${toolName}": legacy tool-policy tier "${context.toolPolicyTier}" cannot use this operation`,
      ErrorCodes.PERMISSION_DENIED,
    );
  }

  if (
    !canLegacyToolPolicyTierAccessExposedTool(
      context.toolPolicyTier,
      toolDefinition,
    )
  ) {
    throw new ToolError(
      `Permission denied for tool "${toolName}": legacy tool-policy tier "${context.toolPolicyTier}" is not allowed`,
      ErrorCodes.PERMISSION_DENIED,
    );
  }

  const requiredCapabilities = getAllRequiredCapabilities(toolDefinition);
  if (requiredCapabilities.length > 0) {
    const granted = new Set(context.capabilities || []);
    const missing = requiredCapabilities.filter((cap) => !granted.has(cap));
    if (missing.length > 0) {
      throw new ToolError(
        `Permission denied for tool "${toolName}": missing capabilities: ${missing.join(
          ", ",
        )}`,
        ErrorCodes.PERMISSION_DENIED,
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Filtering for getAvailableTools
// ---------------------------------------------------------------------------

/** Filter tools by compatibility-tier metadata and granted capabilities. */
export function filterAccessibleTools(
  tools: ToolDefinition[],
  policyTier: ToolContext["toolPolicyTier"],
  capabilities: readonly string[],
): ToolDefinition[] {
  return filterToolsForLegacyPolicyTier(tools, policyTier)
    .filter((tool) =>
      canLegacyToolPolicyTierAccessExposedTool(policyTier, tool)
    )
    .filter((tool) => canUseToolCapabilities(capabilities, tool));
}
