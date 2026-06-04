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
  CUSTOM_DOMAIN_OPS,
  DEPLOYMENT_OPS,
  MCP_SERVER_OPS,
  REPO_OPS,
  SERVICE_OPS,
  SKILL_OPS,
  SPACE_STORAGE_OPS,
} from "./tool-policy-types.ts";

export interface ToolPolicyMetadata {
  tool_class: ToolClass;
  operation_id?: SpaceOperationId;
  composed_operations?: SpaceOperationId[];
  sensitive_read_policy?: SensitiveReadPolicy;
}

export const AGENT_DISABLED_CUSTOM_TOOLS = [
  "key_value_get",
  "key_value_put",
  "key_value_delete",
  "key_value_list",
  "sql_query",
  "sql_tables",
  "sql_describe",
  "object_store_upload",
  "object_store_download",
  "object_store_list",
  "object_store_delete",
  "object_store_info",
  "create_sql",
  "create_key_value",
  "create_object_store",
  "list_resources",
] as const;

export const AGENT_DISABLED_TOOL_SET = new Set<string>(
  AGENT_DISABLED_CUSTOM_TOOLS,
);

export { SPACE_OPERATION_POLICIES } from "./tool-policy-space-operations.ts";

// Re-export all helper functions
export {
  applyCustomToolPolicyMetadata,
  applyToolPolicyMetadata,
  canRoleAccessOperation,
  canRoleAccessTool,
  filterAgentAllowedToolNames,
  filterToolsForRole,
  getSpaceOperationPolicy,
  getToolPolicyMetadata,
  isToolAllowedForAgent,
  validateCustomToolPolicies,
} from "./tool-policy-utils.ts";
