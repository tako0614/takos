import type { SpaceRole } from '../../shared/types';
import type { ToolDefinition } from './tool-definitions';
import type { SpaceOperationId, SpaceOperationPolicy } from './tool-policy-types';
import { type ToolPolicyMetadata } from './tool-policy';
export declare function getSpaceOperationPolicy(operationId: SpaceOperationId): SpaceOperationPolicy;
export declare function getToolPolicyMetadata(tool: ToolDefinition | string): ToolPolicyMetadata;
export declare function applyToolPolicyMetadata(tool: ToolDefinition): ToolDefinition;
export declare function applyBuiltinToolPolicyMetadata(tools: ToolDefinition[]): ToolDefinition[];
export declare function canRoleAccessOperation(role: SpaceRole, operationId: SpaceOperationId): boolean;
export declare function canRoleAccessTool(role: SpaceRole, tool: ToolDefinition): boolean;
export declare function filterToolsForRole(tools: ToolDefinition[], role?: SpaceRole): ToolDefinition[];
export declare function isToolAllowedForAgent(toolName: string): boolean;
export declare function filterAgentAllowedToolNames(toolNames: readonly string[]): string[];
export declare function validateBuiltinToolPolicies(tools: readonly ToolDefinition[]): string[];
//# sourceMappingURL=tool-policy-utils.d.ts.map