import type { SpaceRole } from '../../shared/types';

export type ToolClass = 'workspace_mapped' | 'agent_native' | 'composite';
export type SensitiveReadPolicy = 'none' | 'masked' | 'write_only';

export type SpaceOperationId =
  | 'workspace_storage.list'
  | 'workspace_storage.read'
  | 'workspace_storage.write'
  | 'workspace_storage.create'
  | 'workspace_storage.delete'
  | 'workspace_storage.rename'
  | 'workspace_storage.move'
  | 'workspace_common_env.list'
  | 'workspace_common_env.write'
  | 'workspace_common_env.delete'
  | 'repo.create'
  | 'repo.fork'
  | 'service.list'
  | 'service.create'
  | 'service.delete'
  | 'service.env.read'
  | 'service.env.write'
  | 'service.bindings.read'
  | 'service.bindings.write'
  | 'service.runtime.read'
  | 'service.runtime.write'
  | 'custom_domain.list'
  | 'custom_domain.add'
  | 'custom_domain.verify'
  | 'custom_domain.delete'
  | 'deployment.history'
  | 'deployment.get'
  | 'deployment.rollback'
  | 'skill.list'
  | 'skill.get'
  | 'skill.create'
  | 'skill.update'
  | 'skill.toggle'
  | 'skill.delete'
  | 'skill.context'
  | 'skill.catalog'
  | 'skill.describe'
  | 'app_deployment.list'
  | 'app_deployment.get'
  | 'app_deployment.deploy_from_repo'
  | 'app_deployment.deploy_frontend'
  | 'app_deployment.remove'
  | 'app_deployment.rollback'
  | 'mcp_server.list'
  | 'mcp_server.create'
  | 'mcp_server.update'
  | 'mcp_server.delete';

/** @deprecated Use {@link SpaceOperationId} instead. */
export type WorkspaceOperationId = SpaceOperationId;

export interface SpaceOperationPolicy {
  id: SpaceOperationId;
  user_surface: string;
  allowed_roles: SpaceRole[];
  sensitive_read_policy: SensitiveReadPolicy;
}

/** @deprecated Use {@link SpaceOperationPolicy} instead. */
export type WorkspaceOperationPolicy = SpaceOperationPolicy;
