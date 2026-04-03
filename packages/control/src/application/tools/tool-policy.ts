import type {
  SensitiveReadPolicy,
  ToolClass,
  SpaceOperationId,
} from './tool-policy-types.ts';
export type {
  SensitiveReadPolicy,
  ToolClass,
  SpaceOperationId,
  SpaceOperationPolicy,
} from './tool-policy-types.ts';
export {
  WORKSPACE_STORAGE_OPS,
  WORKSPACE_COMMON_ENV_OPS,
  REPO_OPS,
  SERVICE_OPS,
  CUSTOM_DOMAIN_OPS,
  DEPLOYMENT_OPS,
  SKILL_OPS,
  APP_DEPLOYMENT_OPS,
  MCP_SERVER_OPS,
} from './tool-policy-types.ts';

export interface ToolPolicyMetadata {
  tool_class: ToolClass;
  operation_id?: SpaceOperationId;
  composed_operations?: SpaceOperationId[];
  sensitive_read_policy?: SensitiveReadPolicy;
}

const ALL_SPACE_ROLES: SpaceRole[] = ['owner', 'admin', 'editor', 'viewer'];
const EDITOR_PLUS_ROLES: SpaceRole[] = ['owner', 'admin', 'editor'];
const ADMIN_ROLES: SpaceRole[] = ['owner', 'admin'];

export const AGENT_DISABLED_BUILTIN_TOOLS = [
  'kv_get',
  'kv_put',
  'kv_delete',
  'kv_list',
  'd1_query',
  'd1_tables',
  'd1_describe',
  'r2_upload',
  'r2_download',
  'r2_list',
  'r2_delete',
  'r2_info',
  'create_d1',
  'create_kv',
  'create_r2',
  'list_resources',
] as const;

export const AGENT_DISABLED_TOOL_SET = new Set<string>(AGENT_DISABLED_BUILTIN_TOOLS);

export { SPACE_OPERATION_POLICIES } from './tool-policy-space-operations.ts';

export const BUILTIN_TOOL_POLICY_METADATA: Record<string, ToolPolicyMetadata> = {
  create_repository: {
    tool_class: 'workspace_mapped',
    operation_id: 'repo.create',
  },
  repo_fork: {
    tool_class: 'workspace_mapped',
    operation_id: 'repo.fork',
  },
  workspace_files_list: {
    tool_class: 'workspace_mapped',
    operation_id: 'workspace_storage.list',
  },
  workspace_files_read: {
    tool_class: 'workspace_mapped',
    operation_id: 'workspace_storage.read',
  },
  workspace_files_write: {
    tool_class: 'workspace_mapped',
    operation_id: 'workspace_storage.write',
  },
  workspace_files_create: {
    tool_class: 'workspace_mapped',
    operation_id: 'workspace_storage.create',
  },
  workspace_files_mkdir: {
    tool_class: 'workspace_mapped',
    operation_id: 'workspace_storage.create',
  },
  workspace_files_delete: {
    tool_class: 'workspace_mapped',
    operation_id: 'workspace_storage.delete',
  },
  workspace_files_rename: {
    tool_class: 'workspace_mapped',
    operation_id: 'workspace_storage.rename',
  },
  workspace_files_move: {
    tool_class: 'workspace_mapped',
    operation_id: 'workspace_storage.move',
  },
  service_list: {
    tool_class: 'workspace_mapped',
    operation_id: 'service.list',
  },
  service_create: {
    tool_class: 'workspace_mapped',
    operation_id: 'service.create',
  },
  service_delete: {
    tool_class: 'workspace_mapped',
    operation_id: 'service.delete',
  },
  deployment_history: {
    tool_class: 'workspace_mapped',
    operation_id: 'deployment.history',
  },
  deployment_get: {
    tool_class: 'workspace_mapped',
    operation_id: 'deployment.get',
    sensitive_read_policy: 'masked',
  },
  deployment_rollback: {
    tool_class: 'workspace_mapped',
    operation_id: 'deployment.rollback',
  },
  service_env_get: {
    tool_class: 'workspace_mapped',
    operation_id: 'service.env.read',
    sensitive_read_policy: 'masked',
  },
  service_env_set: {
    tool_class: 'workspace_mapped',
    operation_id: 'service.env.write',
    sensitive_read_policy: 'write_only',
  },
  service_bindings_get: {
    tool_class: 'workspace_mapped',
    operation_id: 'service.bindings.read',
  },
  service_bindings_set: {
    tool_class: 'workspace_mapped',
    operation_id: 'service.bindings.write',
  },
  service_runtime_get: {
    tool_class: 'workspace_mapped',
    operation_id: 'service.runtime.read',
  },
  service_runtime_set: {
    tool_class: 'workspace_mapped',
    operation_id: 'service.runtime.write',
  },
  domain_list: {
    tool_class: 'workspace_mapped',
    operation_id: 'custom_domain.list',
  },
  domain_add: {
    tool_class: 'workspace_mapped',
    operation_id: 'custom_domain.add',
  },
  domain_verify: {
    tool_class: 'workspace_mapped',
    operation_id: 'custom_domain.verify',
  },
  domain_remove: {
    tool_class: 'workspace_mapped',
    operation_id: 'custom_domain.delete',
  },
  workspace_env_list: {
    tool_class: 'workspace_mapped',
    operation_id: 'workspace_common_env.list',
    sensitive_read_policy: 'masked',
  },
  workspace_env_set: {
    tool_class: 'workspace_mapped',
    operation_id: 'workspace_common_env.write',
    sensitive_read_policy: 'write_only',
  },
  workspace_env_delete: {
    tool_class: 'workspace_mapped',
    operation_id: 'workspace_common_env.delete',
    sensitive_read_policy: 'write_only',
  },
  skill_list: {
    tool_class: 'workspace_mapped',
    operation_id: 'skill.list',
  },
  skill_get: {
    tool_class: 'workspace_mapped',
    operation_id: 'skill.get',
  },
  skill_create: {
    tool_class: 'workspace_mapped',
    operation_id: 'skill.create',
  },
  skill_update: {
    tool_class: 'workspace_mapped',
    operation_id: 'skill.update',
  },
  skill_toggle: {
    tool_class: 'workspace_mapped',
    operation_id: 'skill.toggle',
  },
  skill_delete: {
    tool_class: 'workspace_mapped',
    operation_id: 'skill.delete',
  },
  skill_context: {
    tool_class: 'workspace_mapped',
    operation_id: 'skill.context',
  },
  skill_catalog: {
    tool_class: 'workspace_mapped',
    operation_id: 'skill.catalog',
  },
  skill_describe: {
    tool_class: 'workspace_mapped',
    operation_id: 'skill.describe',
  },
  app_deployment_list: {
    tool_class: 'workspace_mapped',
    operation_id: 'app_deployment.list',
  },
  app_deployment_get: {
    tool_class: 'workspace_mapped',
    operation_id: 'app_deployment.get',
  },
  app_deployment_deploy_from_repo: {
    tool_class: 'workspace_mapped',
    operation_id: 'app_deployment.deploy_from_repo',
  },
  deploy_frontend: {
    tool_class: 'workspace_mapped',
    operation_id: 'app_deployment.deploy_frontend',
  },
  app_deployment_remove: {
    tool_class: 'workspace_mapped',
    operation_id: 'app_deployment.remove',
  },
  app_deployment_rollback: {
    tool_class: 'workspace_mapped',
    operation_id: 'app_deployment.rollback',
  },
  mcp_add_server: {
    tool_class: 'workspace_mapped',
    operation_id: 'mcp_server.create',
  },
  mcp_list_servers: {
    tool_class: 'workspace_mapped',
    operation_id: 'mcp_server.list',
  },
  mcp_update_server: {
    tool_class: 'workspace_mapped',
    operation_id: 'mcp_server.update',
  },
  mcp_remove_server: {
    tool_class: 'workspace_mapped',
    operation_id: 'mcp_server.delete',
  },
  // Browser tools — agent_native, no workspace operation mapping
  browser_open: {
    tool_class: 'agent_native',
  },
  browser_goto: {
    tool_class: 'agent_native',
  },
  browser_action: {
    tool_class: 'agent_native',
  },
  browser_screenshot: {
    tool_class: 'agent_native',
  },
  browser_extract: {
    tool_class: 'agent_native',
  },
  browser_html: {
    tool_class: 'agent_native',
  },
  browser_close: {
    tool_class: 'agent_native',
  },
};

// Re-export all helper functions
export {
  getSpaceOperationPolicy,
  getToolPolicyMetadata,
  applyToolPolicyMetadata,
  applyBuiltinToolPolicyMetadata,
  canRoleAccessOperation,
  canRoleAccessTool,
  filterToolsForRole,
  isToolAllowedForAgent,
  filterAgentAllowedToolNames,
  validateBuiltinToolPolicies,
} from './tool-policy-utils.ts';
