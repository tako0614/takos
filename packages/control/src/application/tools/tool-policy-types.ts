import type { SpaceRole } from "../../shared/types/index.ts";

export type ToolClass = "space_mapped" | "agent_native" | "composite";
export type SensitiveReadPolicy = "none" | "masked" | "write_only";

export const SPACE_STORAGE_OPS = [
  "space_storage.list",
  "space_storage.read",
  "space_storage.write",
  "space_storage.create",
  "space_storage.delete",
  "space_storage.rename",
  "space_storage.move",
] as const;

export const REPO_OPS = [
  "repo.create",
  "repo.fork",
] as const;

export const SERVICE_OPS = [
  "service.list",
  "service.create",
  "service.delete",
  "service.env.read",
  "service.env.write",
  "service.runtime.read",
  "service.runtime.write",
] as const;

export const CUSTOM_DOMAIN_OPS = [
  "custom_domain.list",
  "custom_domain.add",
  "custom_domain.verify",
  "custom_domain.delete",
] as const;

export const DEPLOYMENT_OPS = [
  "deployment.history",
  "deployment.get",
  "deployment.rollback",
] as const;

export const SKILL_OPS = [
  "skill.list",
  "skill.get",
  "skill.create",
  "skill.update",
  "skill.toggle",
  "skill.delete",
  "skill.context",
  "skill.catalog",
  "skill.describe",
] as const;

export const GROUP_DEPLOYMENT_SNAPSHOT_OPS = [
  "group_deployment_snapshot.list",
  "group_deployment_snapshot.get",
  "group_deployment_snapshot.deploy_from_repo",
  "group_deployment_snapshot.deploy_frontend",
  "group_deployment_snapshot.remove",
  "group_deployment_snapshot.rollback",
] as const;

export const MCP_SERVER_OPS = [
  "mcp_server.list",
  "mcp_server.create",
  "mcp_server.update",
  "mcp_server.delete",
] as const;

export type SpaceOperationId =
  | (typeof SPACE_STORAGE_OPS)[number]
  | (typeof REPO_OPS)[number]
  | (typeof SERVICE_OPS)[number]
  | (typeof CUSTOM_DOMAIN_OPS)[number]
  | (typeof DEPLOYMENT_OPS)[number]
  | (typeof SKILL_OPS)[number]
  | (typeof GROUP_DEPLOYMENT_SNAPSHOT_OPS)[number]
  | (typeof MCP_SERVER_OPS)[number];

export interface SpaceOperationPolicy {
  id: SpaceOperationId;
  user_surface: string;
  allowed_roles: SpaceRole[];
  sensitive_read_policy: SensitiveReadPolicy;
}
