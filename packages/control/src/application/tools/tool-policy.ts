import type { SpaceRole } from '../../shared/types';
import type { ToolDefinition } from './types';
import type {
  SensitiveReadPolicy,
  ToolClass,
  SpaceOperationId,
  SpaceOperationPolicy,
} from './tool-policy-types';
import { TOOL_NAMESPACE_MAP } from './namespace-map';
export type {
  SensitiveReadPolicy,
  ToolClass,
  SpaceOperationId,
  SpaceOperationPolicy,
  WorkspaceOperationId,
  WorkspaceOperationPolicy,
} from './tool-policy-types';

interface ToolPolicyMetadata {
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

const AGENT_DISABLED_TOOL_SET = new Set<string>(AGENT_DISABLED_BUILTIN_TOOLS);

export const SPACE_OPERATION_POLICIES: Record<SpaceOperationId, SpaceOperationPolicy> = {
  'workspace_storage.list': {
    id: 'workspace_storage.list',
    user_surface: 'GET /api/spaces/:spaceId/storage',
    allowed_roles: ALL_SPACE_ROLES,
    sensitive_read_policy: 'none',
  },
  'workspace_storage.read': {
    id: 'workspace_storage.read',
    user_surface: 'GET /api/spaces/:spaceId/storage/:fileId/content',
    allowed_roles: ALL_SPACE_ROLES,
    sensitive_read_policy: 'none',
  },
  'workspace_storage.write': {
    id: 'workspace_storage.write',
    user_surface: 'PUT /api/spaces/:spaceId/storage/:fileId/content',
    allowed_roles: EDITOR_PLUS_ROLES,
    sensitive_read_policy: 'none',
  },
  'workspace_storage.create': {
    id: 'workspace_storage.create',
    user_surface: 'POST /api/spaces/:spaceId/storage/files|folders',
    allowed_roles: EDITOR_PLUS_ROLES,
    sensitive_read_policy: 'none',
  },
  'workspace_storage.delete': {
    id: 'workspace_storage.delete',
    user_surface: 'DELETE /api/spaces/:spaceId/storage/:fileId',
    allowed_roles: EDITOR_PLUS_ROLES,
    sensitive_read_policy: 'none',
  },
  'workspace_storage.rename': {
    id: 'workspace_storage.rename',
    user_surface: 'PATCH /api/spaces/:spaceId/storage/:fileId/rename',
    allowed_roles: EDITOR_PLUS_ROLES,
    sensitive_read_policy: 'none',
  },
  'workspace_storage.move': {
    id: 'workspace_storage.move',
    user_surface: 'PATCH /api/spaces/:spaceId/storage/:fileId/move',
    allowed_roles: EDITOR_PLUS_ROLES,
    sensitive_read_policy: 'none',
  },
  'workspace_common_env.list': {
    id: 'workspace_common_env.list',
    user_surface: 'GET /api/spaces/:spaceId/common-env',
    allowed_roles: ALL_SPACE_ROLES,
    sensitive_read_policy: 'masked',
  },
  'workspace_common_env.write': {
    id: 'workspace_common_env.write',
    user_surface: 'PUT /api/spaces/:spaceId/common-env',
    allowed_roles: ADMIN_ROLES,
    sensitive_read_policy: 'write_only',
  },
  'workspace_common_env.delete': {
    id: 'workspace_common_env.delete',
    user_surface: 'DELETE /api/spaces/:spaceId/common-env/:name',
    allowed_roles: ADMIN_ROLES,
    sensitive_read_policy: 'write_only',
  },
  'repo.create': {
    id: 'repo.create',
    user_surface: 'POST /api/spaces/:spaceId/repos',
    allowed_roles: EDITOR_PLUS_ROLES,
    sensitive_read_policy: 'none',
  },
  'repo.fork': {
    id: 'repo.fork',
    user_surface: 'POST /api/repos/:repoId/fork',
    allowed_roles: EDITOR_PLUS_ROLES,
    sensitive_read_policy: 'none',
  },
  'service.list': {
    id: 'service.list',
    user_surface: 'GET /api/services/space/:spaceId',
    allowed_roles: ALL_SPACE_ROLES,
    sensitive_read_policy: 'none',
  },
  'service.create': {
    id: 'service.create',
    user_surface: 'POST /api/services',
    allowed_roles: EDITOR_PLUS_ROLES,
    sensitive_read_policy: 'none',
  },
  'service.delete': {
    id: 'service.delete',
    user_surface: 'DELETE /api/services/:id',
    allowed_roles: ADMIN_ROLES,
    sensitive_read_policy: 'none',
  },
  'service.env.read': {
    id: 'service.env.read',
    user_surface: 'GET /api/services/:id/env',
    allowed_roles: ALL_SPACE_ROLES,
    sensitive_read_policy: 'masked',
  },
  'service.env.write': {
    id: 'service.env.write',
    user_surface: 'PATCH /api/services/:id/env',
    allowed_roles: EDITOR_PLUS_ROLES,
    sensitive_read_policy: 'write_only',
  },
  'service.bindings.read': {
    id: 'service.bindings.read',
    user_surface: 'GET /api/services/:id/bindings',
    allowed_roles: ALL_SPACE_ROLES,
    sensitive_read_policy: 'none',
  },
  'service.bindings.write': {
    id: 'service.bindings.write',
    user_surface: 'PATCH /api/services/:id/bindings',
    allowed_roles: EDITOR_PLUS_ROLES,
    sensitive_read_policy: 'none',
  },
  'service.runtime.read': {
    id: 'service.runtime.read',
    user_surface: 'GET /api/services/:id/settings',
    allowed_roles: ALL_SPACE_ROLES,
    sensitive_read_policy: 'none',
  },
  'service.runtime.write': {
    id: 'service.runtime.write',
    user_surface: 'PATCH /api/services/:id/settings',
    allowed_roles: EDITOR_PLUS_ROLES,
    sensitive_read_policy: 'none',
  },
  'custom_domain.list': {
    id: 'custom_domain.list',
    user_surface: 'GET /api/services/:id/domains',
    allowed_roles: ALL_SPACE_ROLES,
    sensitive_read_policy: 'none',
  },
  'custom_domain.add': {
    id: 'custom_domain.add',
    user_surface: 'POST /api/services/:id/domains',
    allowed_roles: EDITOR_PLUS_ROLES,
    sensitive_read_policy: 'none',
  },
  'custom_domain.verify': {
    id: 'custom_domain.verify',
    user_surface: 'POST /api/services/:id/domains/verify',
    allowed_roles: EDITOR_PLUS_ROLES,
    sensitive_read_policy: 'none',
  },
  'custom_domain.delete': {
    id: 'custom_domain.delete',
    user_surface: 'DELETE /api/services/:id/domains/:domain',
    allowed_roles: EDITOR_PLUS_ROLES,
    sensitive_read_policy: 'none',
  },
  'deployment.history': {
    id: 'deployment.history',
    user_surface: 'GET /api/services/:id/deployments',
    allowed_roles: ALL_SPACE_ROLES,
    sensitive_read_policy: 'none',
  },
  'deployment.get': {
    id: 'deployment.get',
    user_surface: 'GET /api/services/:id/deployments/:deploymentId',
    allowed_roles: ALL_SPACE_ROLES,
    sensitive_read_policy: 'masked',
  },
  'deployment.rollback': {
    id: 'deployment.rollback',
    user_surface: 'POST /api/services/:id/deployments/rollback',
    allowed_roles: EDITOR_PLUS_ROLES,
    sensitive_read_policy: 'none',
  },
  'skill.list': {
    id: 'skill.list',
    user_surface: 'GET /api/spaces/:spaceId/skills',
    allowed_roles: ALL_SPACE_ROLES,
    sensitive_read_policy: 'none',
  },
  'skill.get': {
    id: 'skill.get',
    user_surface: 'GET /api/spaces/:spaceId/skills/id/:skillId | GET /api/spaces/:spaceId/skills/:skillName',
    allowed_roles: ALL_SPACE_ROLES,
    sensitive_read_policy: 'none',
  },
  'skill.create': {
    id: 'skill.create',
    user_surface: 'POST /api/spaces/:spaceId/skills',
    allowed_roles: EDITOR_PLUS_ROLES,
    sensitive_read_policy: 'none',
  },
  'skill.update': {
    id: 'skill.update',
    user_surface: 'PUT /api/spaces/:spaceId/skills/id/:skillId | PUT /api/spaces/:spaceId/skills/:skillName',
    allowed_roles: EDITOR_PLUS_ROLES,
    sensitive_read_policy: 'none',
  },
  'skill.toggle': {
    id: 'skill.toggle',
    user_surface: 'PATCH /api/spaces/:spaceId/skills/id/:skillId | PATCH /api/spaces/:spaceId/skills/:skillName',
    allowed_roles: EDITOR_PLUS_ROLES,
    sensitive_read_policy: 'none',
  },
  'skill.delete': {
    id: 'skill.delete',
    user_surface: 'DELETE /api/spaces/:spaceId/skills/id/:skillId | DELETE /api/spaces/:spaceId/skills/:skillName',
    allowed_roles: ADMIN_ROLES,
    sensitive_read_policy: 'none',
  },
  'skill.context': {
    id: 'skill.context',
    user_surface: 'GET /api/spaces/:spaceId/skills-context',
    allowed_roles: ALL_SPACE_ROLES,
    sensitive_read_policy: 'none',
  },
  'skill.catalog': {
    id: 'skill.catalog',
    user_surface: 'GET /api/spaces/:spaceId/skills-context',
    allowed_roles: ALL_SPACE_ROLES,
    sensitive_read_policy: 'none',
  },
  'skill.describe': {
    id: 'skill.describe',
    user_surface: 'GET /api/spaces/:spaceId/official-skills/:skillId | GET /api/spaces/:spaceId/skills/id/:skillId | GET /api/spaces/:spaceId/skills/:skillName',
    allowed_roles: ALL_SPACE_ROLES,
    sensitive_read_policy: 'none',
  },
  'app_deployment.list': {
    id: 'app_deployment.list',
    user_surface: 'GET /api/spaces/:spaceId/app-deployments',
    allowed_roles: ALL_SPACE_ROLES,
    sensitive_read_policy: 'none',
  },
  'app_deployment.get': {
    id: 'app_deployment.get',
    user_surface: 'GET /api/spaces/:spaceId/app-deployments/:appDeploymentId',
    allowed_roles: ALL_SPACE_ROLES,
    sensitive_read_policy: 'none',
  },
  'app_deployment.deploy_from_repo': {
    id: 'app_deployment.deploy_from_repo',
    user_surface: 'POST /api/spaces/:spaceId/app-deployments',
    allowed_roles: ADMIN_ROLES,
    sensitive_read_policy: 'none',
  },
  'app_deployment.deploy_frontend': {
    id: 'app_deployment.deploy_frontend',
    user_surface: 'builtin deploy_frontend',
    allowed_roles: ADMIN_ROLES,
    sensitive_read_policy: 'none',
  },
  'app_deployment.remove': {
    id: 'app_deployment.remove',
    user_surface: 'DELETE /api/spaces/:spaceId/app-deployments/:appDeploymentId',
    allowed_roles: ADMIN_ROLES,
    sensitive_read_policy: 'none',
  },
  'app_deployment.rollback': {
    id: 'app_deployment.rollback',
    user_surface: 'POST /api/spaces/:spaceId/app-deployments/:appDeploymentId/rollback',
    allowed_roles: ADMIN_ROLES,
    sensitive_read_policy: 'none',
  },
  'mcp_server.list': {
    id: 'mcp_server.list',
    user_surface: 'GET /api/mcp/servers?spaceId=...',
    allowed_roles: ALL_SPACE_ROLES,
    sensitive_read_policy: 'none',
  },
  'mcp_server.create': {
    id: 'mcp_server.create',
    user_surface: 'builtin mcp_add_server + OAuth callback',
    allowed_roles: EDITOR_PLUS_ROLES,
    sensitive_read_policy: 'none',
  },
  'mcp_server.update': {
    id: 'mcp_server.update',
    user_surface: 'PATCH /api/mcp/servers/:id?spaceId=...',
    allowed_roles: EDITOR_PLUS_ROLES,
    sensitive_read_policy: 'none',
  },
  'mcp_server.delete': {
    id: 'mcp_server.delete',
    user_surface: 'DELETE /api/mcp/servers/:id?spaceId=...',
    allowed_roles: EDITOR_PLUS_ROLES,
    sensitive_read_policy: 'none',
  },
};

const BUILTIN_TOOL_POLICY_METADATA: Record<string, ToolPolicyMetadata> = {
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

function inferDefaultToolClass(_toolName: string): ToolClass {
  return 'agent_native';
}

export function getSpaceOperationPolicy(operationId: SpaceOperationId): SpaceOperationPolicy {
  return SPACE_OPERATION_POLICIES[operationId];
}

export function getToolPolicyMetadata(tool: ToolDefinition | string): ToolPolicyMetadata {
  const name = typeof tool === 'string' ? tool : tool.name;
  const registered = BUILTIN_TOOL_POLICY_METADATA[name];

  if (typeof tool === 'string') {
    return registered || {
      tool_class: inferDefaultToolClass(name),
    };
  }

  return {
    tool_class: tool.tool_class ?? registered?.tool_class ?? inferDefaultToolClass(name),
    operation_id: tool.operation_id ?? registered?.operation_id,
    composed_operations: tool.composed_operations ?? registered?.composed_operations,
    sensitive_read_policy: tool.sensitive_read_policy ?? registered?.sensitive_read_policy,
  };
}

export function applyToolPolicyMetadata(tool: ToolDefinition): ToolDefinition {
  const metadata = getToolPolicyMetadata(tool);
  const nsMeta = TOOL_NAMESPACE_MAP[tool.name];
  return {
    ...tool,
    ...metadata,
    sensitive_read_policy: metadata.sensitive_read_policy ?? tool.sensitive_read_policy,
    namespace: tool.namespace ?? nsMeta?.namespace,
    family: tool.family ?? nsMeta?.family,
    risk_level: tool.risk_level ?? nsMeta?.risk_level,
    side_effects: tool.side_effects ?? nsMeta?.side_effects,
  };
}

export function applyBuiltinToolPolicyMetadata(tools: ToolDefinition[]): ToolDefinition[] {
  return tools.map(applyToolPolicyMetadata);
}

export function canRoleAccessOperation(role: SpaceRole, operationId: SpaceOperationId): boolean {
  return getSpaceOperationPolicy(operationId).allowed_roles.includes(role);
}

export function canRoleAccessTool(role: SpaceRole, tool: ToolDefinition): boolean {
  const metadata = getToolPolicyMetadata(tool);

  if (metadata.tool_class === 'workspace_mapped') {
    if (!metadata.operation_id) return false;
    return canRoleAccessOperation(role, metadata.operation_id);
  }

  if (metadata.tool_class === 'composite') {
    return (metadata.composed_operations || []).every((operationId) => canRoleAccessOperation(role, operationId));
  }

  return true;
}

export function filterToolsForRole(tools: ToolDefinition[], role?: SpaceRole): ToolDefinition[] {
  if (!role) return tools;
  return tools.filter((tool) => canRoleAccessTool(role, tool));
}

export function isToolAllowedForAgent(toolName: string): boolean {
  return !AGENT_DISABLED_TOOL_SET.has(toolName);
}

export function filterAgentAllowedToolNames(toolNames: readonly string[]): string[] {
  return toolNames.filter(isToolAllowedForAgent);
}

export function validateBuiltinToolPolicies(tools: readonly ToolDefinition[]): string[] {
  const errors: string[] = [];
  const toolNames = new Set(tools.map((tool) => tool.name));

  for (const tool of tools) {
    const metadata = getToolPolicyMetadata(tool);
    if (metadata.tool_class === 'workspace_mapped' && !metadata.operation_id) {
      errors.push(`Tool "${tool.name}" is workspace_mapped but has no operation_id`);
    }
    if (metadata.tool_class === 'workspace_mapped' && metadata.operation_id && !(metadata.operation_id in SPACE_OPERATION_POLICIES)) {
      errors.push(`Tool "${tool.name}" references unknown operation "${metadata.operation_id}"`);
    }
  }

  return errors;
}
