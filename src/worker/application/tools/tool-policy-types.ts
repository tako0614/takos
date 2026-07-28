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

export const MCP_SERVER_OPS = [
  "mcp_server.list",
  "mcp_server.create",
  "mcp_server.update",
  "mcp_server.delete",
] as const;

export type SpaceOperationId =
  | (typeof SPACE_STORAGE_OPS)[number]
  | (typeof SKILL_OPS)[number]
  | (typeof MCP_SERVER_OPS)[number];

export interface SpaceOperationPolicy {
  id: SpaceOperationId;
  user_surface: string;
  allowed_roles: SpaceRole[];
  sensitive_read_policy: SensitiveReadPolicy;
}
