import type { D1Database } from '../types/bindings.ts';
import type { WorkspaceRole, Workspace, WorkspaceMember } from '../types';
import { isValidOpaqueId } from './db-guards';
import { resolveUserPrincipalId } from '../../application/services/identity/principals';
import { getDb } from '../../infra/db';
import { accounts, accountMemberships } from '../../infra/db/schema';
import { eq, and, or } from 'drizzle-orm';

function toWorkspace(row: typeof accounts.$inferSelect): Workspace {
  const kind = row.type === 'user' ? 'user' : row.type === 'system' ? 'system' : 'team';
  return {
    id: row.id,
    kind: kind as 'user' | 'team' | 'system',
    name: row.name,
    slug: row.slug,
    description: row.description,
    principal_id: row.id,
    owner_user_id: row.type === 'user' ? row.id : (row.ownerAccountId ?? row.id),
    owner_principal_id: row.type === 'user' ? row.id : (row.ownerAccountId ?? row.id),
    automation_principal_id: null,
    head_snapshot_id: row.headSnapshotId,
    ai_model: row.aiModel,
    ai_provider: row.aiProvider,
    security_posture: row.securityPosture === 'restricted_egress' ? 'restricted_egress' : 'standard',
    created_at: row.createdAt,
    updated_at: row.updatedAt,
  };
}

function toWorkspaceMember(row: typeof accountMemberships.$inferSelect): WorkspaceMember {
  return {
    id: row.id,
    space_id: row.accountId,
    principal_id: row.memberId,
    role: row.role as WorkspaceRole,
    created_at: row.createdAt,
  };
}

export async function loadSpace(
  db: D1Database,
  spaceIdOrSlug: string,
  userId: string
): Promise<Workspace | null> {
  const drizzle = getDb(db);

  if (spaceIdOrSlug === 'me') {
    const row = await drizzle.select().from(accounts)
      .where(and(eq(accounts.id, userId), eq(accounts.type, 'user')))
      .limit(1)
      .get();
    return row ? toWorkspace(row) : null;
  }

  const row = await drizzle.select().from(accounts)
    .where(or(eq(accounts.id, spaceIdOrSlug), eq(accounts.slug, spaceIdOrSlug)))
    .limit(1)
    .get();

  return row ? toWorkspace(row) : null;
}

export async function loadSpaceMembership(
  db: D1Database,
  spaceId: string,
  principalId: string
): Promise<WorkspaceMember | null> {
  const drizzle = getDb(db);
  const row = await drizzle.select().from(accountMemberships)
    .where(and(eq(accountMemberships.accountId, spaceId), eq(accountMemberships.memberId, principalId)))
    .limit(1)
    .get();

  return row ? toWorkspaceMember(row) : null;
}

export interface WorkspaceAccess {
  workspace: Workspace;
  member: WorkspaceMember;
}

export async function checkWorkspaceAccess(
  db: D1Database,
  spaceIdOrSlug: string,
  userId: string,
  requiredRoles?: WorkspaceRole[]
): Promise<WorkspaceAccess | null> {
  if (!isValidOpaqueId(userId)) {
    return null;
  }
  const principalId = await resolveUserPrincipalId(db, userId);
  if (!principalId) {
    return null;
  }

  const workspace = await loadSpace(db, spaceIdOrSlug, userId);
  if (!workspace) {
    return null;
  }

  const member = await loadSpaceMembership(db, workspace.id, principalId);
  if (!member) {
    return null;
  }

  if (requiredRoles && !requiredRoles.includes(member.role)) {
    return null;
  }

  return { workspace, member };
}

export function hasPermission(
  userRole: WorkspaceRole | null,
  requiredRole: 'owner' | 'admin' | 'editor' | 'viewer'
): boolean {
  if (!userRole) return false;

  const roleLevel: Record<WorkspaceRole, number> = {
    owner: 4,
    admin: 3,
    editor: 2,
    viewer: 1,
  };

  return roleLevel[userRole] >= roleLevel[requiredRole];
}
