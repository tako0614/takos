import type { SpaceRole } from '../../shared/types';
export type ToolClass = 'workspace_mapped' | 'agent_native' | 'composite';
export type SensitiveReadPolicy = 'none' | 'masked' | 'write_only';
export declare const WORKSPACE_STORAGE_OPS: readonly ["workspace_storage.list", "workspace_storage.read", "workspace_storage.write", "workspace_storage.create", "workspace_storage.delete", "workspace_storage.rename", "workspace_storage.move"];
export declare const WORKSPACE_COMMON_ENV_OPS: readonly ["workspace_common_env.list", "workspace_common_env.write", "workspace_common_env.delete"];
export declare const REPO_OPS: readonly ["repo.create", "repo.fork"];
export declare const SERVICE_OPS: readonly ["service.list", "service.create", "service.delete", "service.env.read", "service.env.write", "service.bindings.read", "service.bindings.write", "service.runtime.read", "service.runtime.write"];
export declare const CUSTOM_DOMAIN_OPS: readonly ["custom_domain.list", "custom_domain.add", "custom_domain.verify", "custom_domain.delete"];
export declare const DEPLOYMENT_OPS: readonly ["deployment.history", "deployment.get", "deployment.rollback"];
export declare const SKILL_OPS: readonly ["skill.list", "skill.get", "skill.create", "skill.update", "skill.toggle", "skill.delete", "skill.context", "skill.catalog", "skill.describe"];
export declare const APP_DEPLOYMENT_OPS: readonly ["app_deployment.list", "app_deployment.get", "app_deployment.deploy_from_repo", "app_deployment.deploy_frontend", "app_deployment.remove", "app_deployment.rollback"];
export declare const MCP_SERVER_OPS: readonly ["mcp_server.list", "mcp_server.create", "mcp_server.update", "mcp_server.delete"];
export type SpaceOperationId = (typeof WORKSPACE_STORAGE_OPS)[number] | (typeof WORKSPACE_COMMON_ENV_OPS)[number] | (typeof REPO_OPS)[number] | (typeof SERVICE_OPS)[number] | (typeof CUSTOM_DOMAIN_OPS)[number] | (typeof DEPLOYMENT_OPS)[number] | (typeof SKILL_OPS)[number] | (typeof APP_DEPLOYMENT_OPS)[number] | (typeof MCP_SERVER_OPS)[number];
export interface SpaceOperationPolicy {
    id: SpaceOperationId;
    user_surface: string;
    allowed_roles: SpaceRole[];
    sensitive_read_policy: SensitiveReadPolicy;
}
//# sourceMappingURL=tool-policy-types.d.ts.map