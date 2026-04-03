import type { SpaceRole } from "../../shared/types/index.ts";
import type {
  SpaceOperationId,
  SpaceOperationPolicy,
} from "./tool-policy-types.ts";

const ALL_SPACE_ROLES: SpaceRole[] = ["owner", "admin", "editor", "viewer"];
const EDITOR_PLUS_ROLES: SpaceRole[] = ["owner", "admin", "editor"];
const ADMIN_ROLES: SpaceRole[] = ["owner", "admin"];

export const SPACE_OPERATION_POLICIES: Record<
  SpaceOperationId,
  SpaceOperationPolicy
> = {
  "workspace_storage.list": {
    id: "workspace_storage.list",
    user_surface: "GET /api/spaces/:spaceId/storage",
    allowed_roles: ALL_SPACE_ROLES,
    sensitive_read_policy: "none",
  },
  "workspace_storage.read": {
    id: "workspace_storage.read",
    user_surface: "GET /api/spaces/:spaceId/storage/:fileId/content",
    allowed_roles: ALL_SPACE_ROLES,
    sensitive_read_policy: "none",
  },
  "workspace_storage.write": {
    id: "workspace_storage.write",
    user_surface: "PUT /api/spaces/:spaceId/storage/:fileId/content",
    allowed_roles: EDITOR_PLUS_ROLES,
    sensitive_read_policy: "none",
  },
  "workspace_storage.create": {
    id: "workspace_storage.create",
    user_surface: "POST /api/spaces/:spaceId/storage/files|folders",
    allowed_roles: EDITOR_PLUS_ROLES,
    sensitive_read_policy: "none",
  },
  "workspace_storage.delete": {
    id: "workspace_storage.delete",
    user_surface: "DELETE /api/spaces/:spaceId/storage/:fileId",
    allowed_roles: EDITOR_PLUS_ROLES,
    sensitive_read_policy: "none",
  },
  "workspace_storage.rename": {
    id: "workspace_storage.rename",
    user_surface: "PATCH /api/spaces/:spaceId/storage/:fileId/rename",
    allowed_roles: EDITOR_PLUS_ROLES,
    sensitive_read_policy: "none",
  },
  "workspace_storage.move": {
    id: "workspace_storage.move",
    user_surface: "PATCH /api/spaces/:spaceId/storage/:fileId/move",
    allowed_roles: EDITOR_PLUS_ROLES,
    sensitive_read_policy: "none",
  },
  "workspace_common_env.list": {
    id: "workspace_common_env.list",
    user_surface: "GET /api/spaces/:spaceId/common-env",
    allowed_roles: ALL_SPACE_ROLES,
    sensitive_read_policy: "masked",
  },
  "workspace_common_env.write": {
    id: "workspace_common_env.write",
    user_surface: "PUT /api/spaces/:spaceId/common-env",
    allowed_roles: ADMIN_ROLES,
    sensitive_read_policy: "write_only",
  },
  "workspace_common_env.delete": {
    id: "workspace_common_env.delete",
    user_surface: "DELETE /api/spaces/:spaceId/common-env/:name",
    allowed_roles: ADMIN_ROLES,
    sensitive_read_policy: "write_only",
  },
  "repo.create": {
    id: "repo.create",
    user_surface: "POST /api/spaces/:spaceId/repos",
    allowed_roles: EDITOR_PLUS_ROLES,
    sensitive_read_policy: "none",
  },
  "repo.fork": {
    id: "repo.fork",
    user_surface: "POST /api/repos/:repoId/fork",
    allowed_roles: EDITOR_PLUS_ROLES,
    sensitive_read_policy: "none",
  },
  "service.list": {
    id: "service.list",
    user_surface: "GET /api/services/space/:spaceId",
    allowed_roles: ALL_SPACE_ROLES,
    sensitive_read_policy: "none",
  },
  "service.create": {
    id: "service.create",
    user_surface: "POST /api/services",
    allowed_roles: EDITOR_PLUS_ROLES,
    sensitive_read_policy: "none",
  },
  "service.delete": {
    id: "service.delete",
    user_surface: "DELETE /api/services/:id",
    allowed_roles: ADMIN_ROLES,
    sensitive_read_policy: "none",
  },
  "service.env.read": {
    id: "service.env.read",
    user_surface: "GET /api/services/:id/env",
    allowed_roles: ALL_SPACE_ROLES,
    sensitive_read_policy: "masked",
  },
  "service.env.write": {
    id: "service.env.write",
    user_surface: "PATCH /api/services/:id/env",
    allowed_roles: EDITOR_PLUS_ROLES,
    sensitive_read_policy: "write_only",
  },
  "service.bindings.read": {
    id: "service.bindings.read",
    user_surface: "GET /api/services/:id/bindings",
    allowed_roles: ALL_SPACE_ROLES,
    sensitive_read_policy: "none",
  },
  "service.bindings.write": {
    id: "service.bindings.write",
    user_surface: "PATCH /api/services/:id/bindings",
    allowed_roles: EDITOR_PLUS_ROLES,
    sensitive_read_policy: "none",
  },
  "service.runtime.read": {
    id: "service.runtime.read",
    user_surface: "GET /api/services/:id/settings",
    allowed_roles: ALL_SPACE_ROLES,
    sensitive_read_policy: "none",
  },
  "service.runtime.write": {
    id: "service.runtime.write",
    user_surface: "PATCH /api/services/:id/settings",
    allowed_roles: EDITOR_PLUS_ROLES,
    sensitive_read_policy: "none",
  },
  "custom_domain.list": {
    id: "custom_domain.list",
    user_surface: "GET /api/services/:id/domains",
    allowed_roles: ALL_SPACE_ROLES,
    sensitive_read_policy: "none",
  },
  "custom_domain.add": {
    id: "custom_domain.add",
    user_surface: "POST /api/services/:id/domains",
    allowed_roles: EDITOR_PLUS_ROLES,
    sensitive_read_policy: "none",
  },
  "custom_domain.verify": {
    id: "custom_domain.verify",
    user_surface: "POST /api/services/:id/domains/verify",
    allowed_roles: EDITOR_PLUS_ROLES,
    sensitive_read_policy: "none",
  },
  "custom_domain.delete": {
    id: "custom_domain.delete",
    user_surface: "DELETE /api/services/:id/domains/:domain",
    allowed_roles: EDITOR_PLUS_ROLES,
    sensitive_read_policy: "none",
  },
  "deployment.history": {
    id: "deployment.history",
    user_surface: "GET /api/services/:id/deployments",
    allowed_roles: ALL_SPACE_ROLES,
    sensitive_read_policy: "none",
  },
  "deployment.get": {
    id: "deployment.get",
    user_surface: "GET /api/services/:id/deployments/:deploymentId",
    allowed_roles: ALL_SPACE_ROLES,
    sensitive_read_policy: "masked",
  },
  "deployment.rollback": {
    id: "deployment.rollback",
    user_surface: "POST /api/services/:id/deployments/rollback",
    allowed_roles: EDITOR_PLUS_ROLES,
    sensitive_read_policy: "none",
  },
  "skill.list": {
    id: "skill.list",
    user_surface: "GET /api/spaces/:spaceId/skills",
    allowed_roles: ALL_SPACE_ROLES,
    sensitive_read_policy: "none",
  },
  "skill.get": {
    id: "skill.get",
    user_surface:
      "GET /api/spaces/:spaceId/skills/id/:skillId | GET /api/spaces/:spaceId/skills/:skillName",
    allowed_roles: ALL_SPACE_ROLES,
    sensitive_read_policy: "none",
  },
  "skill.create": {
    id: "skill.create",
    user_surface: "POST /api/spaces/:spaceId/skills",
    allowed_roles: EDITOR_PLUS_ROLES,
    sensitive_read_policy: "none",
  },
  "skill.update": {
    id: "skill.update",
    user_surface:
      "PUT /api/spaces/:spaceId/skills/id/:skillId | PUT /api/spaces/:spaceId/skills/:skillName",
    allowed_roles: EDITOR_PLUS_ROLES,
    sensitive_read_policy: "none",
  },
  "skill.toggle": {
    id: "skill.toggle",
    user_surface:
      "PATCH /api/spaces/:spaceId/skills/id/:skillId | PATCH /api/spaces/:spaceId/skills/:skillName",
    allowed_roles: EDITOR_PLUS_ROLES,
    sensitive_read_policy: "none",
  },
  "skill.delete": {
    id: "skill.delete",
    user_surface:
      "DELETE /api/spaces/:spaceId/skills/id/:skillId | DELETE /api/spaces/:spaceId/skills/:skillName",
    allowed_roles: ADMIN_ROLES,
    sensitive_read_policy: "none",
  },
  "skill.context": {
    id: "skill.context",
    user_surface: "GET /api/spaces/:spaceId/skills-context",
    allowed_roles: ALL_SPACE_ROLES,
    sensitive_read_policy: "none",
  },
  "skill.catalog": {
    id: "skill.catalog",
    user_surface: "GET /api/spaces/:spaceId/skills-context",
    allowed_roles: ALL_SPACE_ROLES,
    sensitive_read_policy: "none",
  },
  "skill.describe": {
    id: "skill.describe",
    user_surface:
      "GET /api/spaces/:spaceId/official-skills/:skillId | GET /api/spaces/:spaceId/skills/id/:skillId | GET /api/spaces/:spaceId/skills/:skillName",
    allowed_roles: ALL_SPACE_ROLES,
    sensitive_read_policy: "none",
  },
  "app_deployment.list": {
    id: "app_deployment.list",
    user_surface: "GET /api/spaces/:spaceId/app-deployments",
    allowed_roles: ALL_SPACE_ROLES,
    sensitive_read_policy: "none",
  },
  "app_deployment.get": {
    id: "app_deployment.get",
    user_surface: "GET /api/spaces/:spaceId/app-deployments/:appDeploymentId",
    allowed_roles: ALL_SPACE_ROLES,
    sensitive_read_policy: "none",
  },
  "app_deployment.deploy_from_repo": {
    id: "app_deployment.deploy_from_repo",
    user_surface: "POST /api/spaces/:spaceId/app-deployments",
    allowed_roles: ADMIN_ROLES,
    sensitive_read_policy: "none",
  },
  "app_deployment.deploy_frontend": {
    id: "app_deployment.deploy_frontend",
    user_surface: "builtin deploy_frontend",
    allowed_roles: ADMIN_ROLES,
    sensitive_read_policy: "none",
  },
  "app_deployment.remove": {
    id: "app_deployment.remove",
    user_surface: "DELETE /api/spaces/:spaceId/app-deployments/:appDeploymentId",
    allowed_roles: ADMIN_ROLES,
    sensitive_read_policy: "none",
  },
  "app_deployment.rollback": {
    id: "app_deployment.rollback",
    user_surface:
      "POST /api/spaces/:spaceId/app-deployments/:appDeploymentId/rollback",
    allowed_roles: ADMIN_ROLES,
    sensitive_read_policy: "none",
  },
  "mcp_server.list": {
    id: "mcp_server.list",
    user_surface: "GET /api/mcp/servers?spaceId=...",
    allowed_roles: ALL_SPACE_ROLES,
    sensitive_read_policy: "none",
  },
  "mcp_server.create": {
    id: "mcp_server.create",
    user_surface: "builtin mcp_add_server + OAuth callback",
    allowed_roles: EDITOR_PLUS_ROLES,
    sensitive_read_policy: "none",
  },
  "mcp_server.update": {
    id: "mcp_server.update",
    user_surface: "PATCH /api/mcp/servers/:id?spaceId=...",
    allowed_roles: EDITOR_PLUS_ROLES,
    sensitive_read_policy: "none",
  },
  "mcp_server.delete": {
    id: "mcp_server.delete",
    user_surface: "DELETE /api/mcp/servers/:id?spaceId=...",
    allowed_roles: EDITOR_PLUS_ROLES,
    sensitive_read_policy: "none",
  },
};
