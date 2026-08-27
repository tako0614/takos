import type {
  SensitiveReadPolicy,
  SpaceOperationId,
  ToolClass,
} from "./tool-policy-types.ts";
export type {
  SensitiveReadPolicy,
  SpaceOperationId,
  SpaceOperationPolicy,
  ToolClass,
} from "./tool-policy-types.ts";
export {
  MCP_SERVER_OPS,
  SKILL_OPS,
  SPACE_STORAGE_OPS,
} from "./tool-policy-types.ts";

export interface ToolPolicyMetadata {
  tool_class: ToolClass;
  operation_id?: SpaceOperationId;
  composed_operations?: SpaceOperationId[];
  sensitive_read_policy?: SensitiveReadPolicy;
}

// Every tool in the static Takos catalog is agent-safe after legacy tool-tier
// metadata and capability policy are applied. A tier never grants Workspace
// authority; the owner proof happens before this catalog is constructed.
export const AGENT_DISABLED_CUSTOM_TOOLS = [] as const;

export const AGENT_DISABLED_TOOL_SET = new Set<string>(
  AGENT_DISABLED_CUSTOM_TOOLS,
);

export { SPACE_OPERATION_POLICIES } from "./tool-policy-space-operations.ts";

// Re-export all helper functions
export {
  applyCustomToolPolicyMetadata,
  applyToolPolicyMetadata,
  canLegacyToolPolicyTierAccessOperation,
  canLegacyToolPolicyTierAccessTool,
  filterAgentAllowedToolNames,
  filterToolsForLegacyPolicyTier,
  getSpaceOperationPolicy,
  getToolPolicyMetadata,
  isToolAllowedForAgent,
  validateCustomToolPolicies,
} from "./tool-policy-utils.ts";
