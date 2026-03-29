/**
 * Permission checks for tool execution.
 *
 * Centralises role-based access control and capability gating that was
 * previously inlined in ToolExecutor.
 */
import type { ToolContext, ToolDefinition } from './tool-definitions';
/** Merge static capability mapping with per-definition required_capabilities. */
export declare function getAllRequiredCapabilities(tool: {
    name: string;
    required_capabilities?: string[];
}): string[];
/** Check whether the caller's role satisfies the tool's `required_roles` list. */
export declare function canRoleAccessExposedTool(role: ToolContext['role'], tool: {
    required_roles?: string[];
}): boolean;
/** Check whether the granted capabilities cover all that the tool requires. */
export declare function canUseToolCapabilities(capabilities: readonly string[], tool: {
    name: string;
    required_capabilities?: string[];
}): boolean;
/**
 * Run all permission checks for a single tool call.
 *
 * Throws a `ToolError` with `ErrorCodes.PERMISSION_DENIED` when access is not
 * allowed. Returns normally when the call is permitted.
 */
export declare function assertToolPermission(toolName: string, toolDefinition: ToolDefinition, context: Pick<ToolContext, 'role' | 'capabilities'>): void;
/** Return only the tools accessible to the given role and capabilities. */
export declare function filterAccessibleTools(tools: ToolDefinition[], role: ToolContext['role'], capabilities: readonly string[]): ToolDefinition[];
//# sourceMappingURL=tool-permission.d.ts.map