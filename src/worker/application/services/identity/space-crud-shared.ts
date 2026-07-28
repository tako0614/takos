import { getDb } from "../../../infra/db/index.ts";
import { isValidOpaqueId } from "../../../shared/utils/db-guards.ts";
import type {
  SecurityPosture,
  Space,
  SpaceRole,
} from "../../../shared/types/index.ts";
import { resolveUserPrincipalId } from "./principals.ts";

export type AccountLikeRow = {
  id: string;
  type: string;
  name: string;
  slug: string;
  description: string | null;
  ownerAccountId: string | null;
  headSnapshotId: string | null;
  aiModel: string | null;
  modelBackend: string | null;
  securityPosture: string | null;
  createdAt: string;
  updatedAt: string;
};

export type MembershipWorkspaceRow = {
  memberRole: string;
  spaceId: string;
  spaceType: string;
  spaceName: string;
  spaceSlug: string;
  spaceOwnerAccountId: string | null;
  spaceHeadSnapshotId: string | null;
  spaceSecurityPosture: string | null;
  spaceCreatedAt: string;
  spaceUpdatedAt: string;
};

export const spaceCrudDeps = {
  getDb,
  resolveUserPrincipalId,
  isValidOpaqueId,
};

export interface SpaceListItem {
  id: string;
  kind: "user" | "team" | "system";
  name: string;
  slug: string | null;
  owner_principal_id: string;
  automation_principal_id?: string | null;
  head_snapshot_id?: string | null;
  security_posture: SecurityPosture;
  created_at: string;
  updated_at: string;
  member_role: SpaceRole;
}

export function toWorkspaceKind(type: string): Space["kind"] {
  return type === "user" ? "user" : "team";
}

export function toSecurityPosture(
  securityPosture: string | null | undefined,
): SecurityPosture {
  return securityPosture === "restricted_egress"
    ? "restricted_egress"
    : "standard";
}

export function accountToWorkspace(row: AccountLikeRow): Space {
  return {
    id: row.id,
    kind: toWorkspaceKind(row.type),
    name: row.name,
    slug: row.slug,
    description: row.description,
    owner_principal_id: row.ownerAccountId ?? row.id,
    head_snapshot_id: row.headSnapshotId,
    ai_model: row.aiModel,
    model_backend: row.modelBackend,
    security_posture: toSecurityPosture(row.securityPosture),
    created_at: row.createdAt,
    updated_at: row.updatedAt,
  };
}

export function toSpaceListItem(row: MembershipWorkspaceRow): SpaceListItem {
  return {
    id: row.spaceId,
    kind: toWorkspaceKind(row.spaceType),
    name: row.spaceName,
    slug: row.spaceSlug,
    owner_principal_id: row.spaceOwnerAccountId ?? row.spaceId,
    automation_principal_id: null,
    head_snapshot_id: row.spaceHeadSnapshotId,
    security_posture: toSecurityPosture(row.spaceSecurityPosture),
    created_at: row.spaceCreatedAt,
    updated_at: row.spaceUpdatedAt,
    member_role: row.memberRole as SpaceRole,
  };
}

export function toPersonalWorkspaceListItem(
  row: Pick<
    AccountLikeRow,
    | "id"
    | "name"
    | "slug"
    | "headSnapshotId"
    | "securityPosture"
    | "createdAt"
    | "updatedAt"
  >,
): SpaceListItem {
  return {
    id: row.id,
    kind: "user",
    name: row.name,
    slug: row.slug,
    owner_principal_id: row.id,
    automation_principal_id: null,
    head_snapshot_id: row.headSnapshotId,
    security_posture: toSecurityPosture(row.securityPosture),
    created_at: row.createdAt,
    updated_at: row.updatedAt,
    member_role: "owner",
  };
}
