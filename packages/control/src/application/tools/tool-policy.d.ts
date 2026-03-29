import type { SensitiveReadPolicy, ToolClass, SpaceOperationId, SpaceOperationPolicy } from './tool-policy-types';
export type { SensitiveReadPolicy, ToolClass, SpaceOperationId, SpaceOperationPolicy, } from './tool-policy-types';
export { WORKSPACE_STORAGE_OPS, WORKSPACE_COMMON_ENV_OPS, REPO_OPS, SERVICE_OPS, CUSTOM_DOMAIN_OPS, DEPLOYMENT_OPS, SKILL_OPS, APP_DEPLOYMENT_OPS, MCP_SERVER_OPS, } from './tool-policy-types';
export interface ToolPolicyMetadata {
    tool_class: ToolClass;
    operation_id?: SpaceOperationId;
    composed_operations?: SpaceOperationId[];
    sensitive_read_policy?: SensitiveReadPolicy;
}
export declare const AGENT_DISABLED_BUILTIN_TOOLS: readonly ["kv_get", "kv_put", "kv_delete", "kv_list", "d1_query", "d1_tables", "d1_describe", "r2_upload", "r2_download", "r2_list", "r2_delete", "r2_info", "create_d1", "create_kv", "create_r2", "list_resources"];
export declare const AGENT_DISABLED_TOOL_SET: Set<string>;
export declare const SPACE_OPERATION_POLICIES: Record<SpaceOperationId, SpaceOperationPolicy>;
export declare const BUILTIN_TOOL_POLICY_METADATA: Record<string, ToolPolicyMetadata>;
export { getSpaceOperationPolicy, getToolPolicyMetadata, applyToolPolicyMetadata, applyBuiltinToolPolicyMetadata, canRoleAccessOperation, canRoleAccessTool, filterToolsForRole, isToolAllowedForAgent, filterAgentAllowedToolNames, validateBuiltinToolPolicies, } from './tool-policy-utils';
//# sourceMappingURL=tool-policy.d.ts.map