import type { SpaceRole } from '../../shared/types/index.ts';

export type ToolClass = 'workspace_mapped' | 'agent_native' | 'composite';
export type SensitiveReadPolicy = 'none' | 'masked' | 'write_only';

export const WORKSPACE_STORAGE_OPS = [
  'workspace_storage.list',
  'workspace_storage.read',
  'workspace_storage.write',
  'workspace_storage.create',
  'workspace_storage.delete',
  'workspace_storage.rename',
  'workspace_storage.move',
] as const;

export const WORKSPACE_COMMON_ENV_OPS = [
  'workspace_common_env.list',
  'workspace_common_env.write',
  'workspace_common_env.delete',
] as const;

export const REPO_OPS = [
  'repo.create',
  'repo.fork',
] as const;

export const SERVICE_OPS = [
  'service.list',
  'service.create',
  'service.delete',
  'service.env.read',
  'service.env.write',
  'service.bindings.read',
  'service.bindings.write',
  'service.runtime.read',
  'service.runtime.write',
] as const;

export const CUSTOM_DOMAIN_OPS = [
  'custom_domain.list',
  'custom_domain.add',
  'custom_domain.verify',
  'custom_domain.delete',
] as const;

export const DEPLOYMENT_OPS = [
  'deployment.history',
  'deployment.get',
  'deployment.rollback',
] as const;

export const SKILL_OPS = [
  'skill.list',
  'skill.get',
  'skill.create',
  'skill.update',
  'skill.toggle',
  'skill.delete',
  'skill.context',
  'skill.catalog',
  'skill.describe',
] as const;

export const APP_DEPLOYMENT_OPS = [
  'app_deployment.list',
  'app_deployment.get',
  'app_deployment.deploy_from_repo',
  'app_deployment.deploy_frontend',
  'app_deployment.remove',
  'app_deployment.rollback',
] as const;

export const MCP_SERVER_OPS = [
  'mcp_server.list',
  'mcp_server.create',
  'mcp_server.update',
  'mcp_server.delete',
] as const;

export type SpaceOperationId =
  | (typeof WORKSPACE_STORAGE_OPS)[number]
  | (typeof WORKSPACE_COMMON_ENV_OPS)[number]
  | (typeof REPO_OPS)[number]
  | (typeof SERVICE_OPS)[number]
  | (typeof CUSTOM_DOMAIN_OPS)[number]
  | (typeof DEPLOYMENT_OPS)[number]
  | (typeof SKILL_OPS)[number]
  | (typeof APP_DEPLOYMENT_OPS)[number]
  | (typeof MCP_SERVER_OPS)[number];


export interface SpaceOperationPolicy {
  id: SpaceOperationId;
  user_surface: string;
  allowed_roles: SpaceRole[];
  sensitive_read_policy: SensitiveReadPolicy;
}

