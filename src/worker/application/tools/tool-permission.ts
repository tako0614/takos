/**
 * Permission checks for tool execution.
 *
 * Centralises capability gating that was
 * previously inlined in ToolExecutor.
 */

import type { ToolContext, ToolDefinition } from "./tool-definitions.ts";
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
  context: Pick<ToolContext, "capabilities">,
): void {
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

/** Return only the tools accessible to the granted capabilities. */
export function filterAccessibleTools(
  tools: ToolDefinition[],
  capabilities: readonly string[],
): ToolDefinition[] {
  return tools.filter((tool) => canUseToolCapabilities(capabilities, tool));
}
