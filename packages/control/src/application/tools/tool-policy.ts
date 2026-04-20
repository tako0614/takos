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
  GROUP_DEPLOYMENT_SNAPSHOT_OPS,
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

export const CUSTOM_TOOL_POLICY_METADATA: Record<string, ToolPolicyMetadata> = {
  create_repository: {
    tool_class: "space_mapped",
    operation_id: "repo.create",
  },
  repo_fork: {
    tool_class: "space_mapped",
    operation_id: "repo.fork",
  },
  space_files_list: {
    tool_class: "space_mapped",
    operation_id: "space_storage.list",
  },
  space_files_read: {
    tool_class: "space_mapped",
    operation_id: "space_storage.read",
  },
  space_files_write: {
    tool_class: "space_mapped",
    operation_id: "space_storage.write",
  },
  space_files_create: {
    tool_class: "space_mapped",
    operation_id: "space_storage.create",
  },
  space_files_mkdir: {
    tool_class: "space_mapped",
    operation_id: "space_storage.create",
  },
  space_files_delete: {
    tool_class: "space_mapped",
    operation_id: "space_storage.delete",
  },
  space_files_rename: {
    tool_class: "space_mapped",
    operation_id: "space_storage.rename",
  },
  space_files_move: {
    tool_class: "space_mapped",
    operation_id: "space_storage.move",
  },
  service_list: {
    tool_class: "space_mapped",
    operation_id: "service.list",
  },
  service_create: {
    tool_class: "space_mapped",
    operation_id: "service.create",
  },
  service_delete: {
    tool_class: "space_mapped",
    operation_id: "service.delete",
  },
  deployment_history: {
    tool_class: "space_mapped",
    operation_id: "deployment.history",
  },
  deployment_get: {
    tool_class: "space_mapped",
    operation_id: "deployment.get",
    sensitive_read_policy: "masked",
  },
  deployment_rollback: {
    tool_class: "space_mapped",
    operation_id: "deployment.rollback",
  },
  service_env_get: {
    tool_class: "space_mapped",
    operation_id: "service.env.read",
    sensitive_read_policy: "masked",
  },
  service_env_set: {
    tool_class: "space_mapped",
    operation_id: "service.env.write",
    sensitive_read_policy: "write_only",
  },
  service_runtime_get: {
    tool_class: "space_mapped",
    operation_id: "service.runtime.read",
  },
  service_runtime_set: {
    tool_class: "space_mapped",
    operation_id: "service.runtime.write",
  },
  domain_list: {
    tool_class: "space_mapped",
    operation_id: "custom_domain.list",
  },
  domain_add: {
    tool_class: "space_mapped",
    operation_id: "custom_domain.add",
  },
  domain_verify: {
    tool_class: "space_mapped",
    operation_id: "custom_domain.verify",
  },
  domain_remove: {
    tool_class: "space_mapped",
    operation_id: "custom_domain.delete",
  },
  skill_list: {
    tool_class: "space_mapped",
    operation_id: "skill.list",
  },
  skill_get: {
    tool_class: "space_mapped",
    operation_id: "skill.get",
  },
  skill_create: {
    tool_class: "space_mapped",
    operation_id: "skill.create",
  },
  skill_update: {
    tool_class: "space_mapped",
    operation_id: "skill.update",
  },
  skill_toggle: {
    tool_class: "space_mapped",
    operation_id: "skill.toggle",
  },
  skill_delete: {
    tool_class: "space_mapped",
    operation_id: "skill.delete",
  },
  skill_context: {
    tool_class: "space_mapped",
    operation_id: "skill.context",
  },
  skill_catalog: {
    tool_class: "space_mapped",
    operation_id: "skill.catalog",
  },
  skill_describe: {
    tool_class: "space_mapped",
    operation_id: "skill.describe",
  },
  group_deployment_snapshot_list: {
    tool_class: "space_mapped",
    operation_id: "group_deployment_snapshot.list",
  },
  group_deployment_snapshot_get: {
    tool_class: "space_mapped",
    operation_id: "group_deployment_snapshot.get",
  },
  group_deployment_snapshot_deploy_from_repo: {
    tool_class: "space_mapped",
    operation_id: "group_deployment_snapshot.deploy_from_repo",
  },
  group_deployment_snapshot_remove: {
    tool_class: "space_mapped",
    operation_id: "group_deployment_snapshot.remove",
  },
  group_deployment_snapshot_rollback: {
    tool_class: "space_mapped",
    operation_id: "group_deployment_snapshot.rollback",
  },
  deploy_frontend: {
    tool_class: "space_mapped",
    operation_id: "group_deployment_snapshot.deploy_frontend",
  },
  mcp_add_server: {
    tool_class: "space_mapped",
    operation_id: "mcp_server.create",
  },
  mcp_list_servers: {
    tool_class: "space_mapped",
    operation_id: "mcp_server.list",
  },
  mcp_update_server: {
    tool_class: "space_mapped",
    operation_id: "mcp_server.update",
  },
  mcp_remove_server: {
    tool_class: "space_mapped",
    operation_id: "mcp_server.delete",
  },
};

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
