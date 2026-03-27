import type { D1Database } from '../../../shared/types/bindings.ts';
import type { User, SpaceMembership, SpaceRole } from '../../../shared/types';
import { generateId, now } from '../../../shared/utils';
import { resolveActorPrincipalId } from './principals';
import { getDb, accounts, accountMemberships } from '../../../infra/db';
import { eq, and } from 'drizzle-orm';

interface MemberListItem {
  username: string;
  email: string;
  name: string;
  picture: string | null;
  role: string;
  created_at: string;
}

async function resolveMembershipPrincipalId(db: D1Database, actorId: string): Promise<string> {
  const principalId = await resolveActorPrincipalId(db, actorId);
  if (!principalId) {
    throw new Error(`Principal not found for actor ${actorId}`);
  }
  return principalId;
}

export async function listSpaceMembers(
  db: D1Database,
  spaceId: string
): Promise<MemberListItem[]> {
  const drizzle = getDb(db);

  // Join accountMemberships with accounts (member accounts that are users)
  const memberAccounts = drizzle
    .select({
      username: accounts.slug,
      email: accounts.email,
      name: accounts.name,
      picture: accounts.picture,
      role: accountMemberships.role,
      created_at: accountMemberships.createdAt,
    })
    .from(accountMemberships)
    .innerJoin(accounts, eq(accounts.id, accountMemberships.memberId))
    .where(
      and(
        eq(accountMemberships.accountId, spaceId),
        eq(accounts.type, 'user')
      )
    )
    .orderBy(accountMemberships.createdAt);

  const rows = await memberAccounts.all();

  return rows.map((r) => ({
    username: r.username,
    email: r.email ?? '',
    name: r.name,
    picture: r.picture,
    role: r.role,
    created_at: r.created_at,
  }));
}

export async function getUserByEmail(db: D1Database, email: string): Promise<User | null> {
  const drizzle = getDb(db);
  const row = await drizzle
    .select()
    .from(accounts)
    .where(and(eq(accounts.email, email), eq(accounts.type, 'user')))
    .limit(1)
    .get();

  if (!row) return null;

  const user: User = {
    id: row.id,
    principal_id: row.id,
    email: row.email ?? '',
    name: row.name,
    username: row.slug,
    principal_kind: 'user',
    bio: row.bio,
    picture: row.picture,
    trust_tier: row.trustTier,
    setup_completed: row.setupCompleted,
    created_at: row.createdAt,
    updated_at: row.updatedAt,
  };
  return user;
}

export async function getSpaceMember(
  db: D1Database,
  spaceId: string,
  actorId: string
): Promise<SpaceMembership | null> {
  const principalId = await resolveMembershipPrincipalId(db, actorId);
  const drizzle = getDb(db);
  const row = await drizzle
    .select()
    .from(accountMemberships)
    .where(
      and(
        eq(accountMemberships.accountId, spaceId),
        eq(accountMemberships.memberId, principalId)
      )
    )
    .limit(1)
    .get();

  if (!row) return null;

  return {
    id: row.id,
    space_id: row.accountId,
    principal_id: row.memberId,
    role: row.role as SpaceRole,
    created_at: row.createdAt,
  };
}

export async function createSpaceMember(
  db: D1Database,
  spaceId: string,
  actorId: string,
  role: SpaceRole
): Promise<{ role: SpaceRole; created_at: string }> {
  const timestamp = now();
  const principalId = await resolveMembershipPrincipalId(db, actorId);
  const drizzle = getDb(db);
  await drizzle.insert(accountMemberships).values({
    id: generateId(),
    accountId: spaceId,
    memberId: principalId,
    role,
    status: 'active',
    updatedAt: timestamp,
    createdAt: timestamp,
  });

  return { role, created_at: timestamp };
}

export async function updateSpaceMemberRole(
  db: D1Database,
  spaceId: string,
  actorId: string,
  role: SpaceRole
): Promise<void> {
  const principalId = await resolveMembershipPrincipalId(db, actorId);
  const drizzle = getDb(db);
  await drizzle
    .update(accountMemberships)
    .set({ role, updatedAt: now() })
    .where(
      and(
        eq(accountMemberships.accountId, spaceId),
        eq(accountMemberships.memberId, principalId)
      )
    );
}

export async function deleteSpaceMember(
  db: D1Database,
  spaceId: string,
  actorId: string
): Promise<void> {
  const principalId = await resolveMembershipPrincipalId(db, actorId);
  const drizzle = getDb(db);
  await drizzle
    .delete(accountMemberships)
    .where(
      and(
        eq(accountMemberships.accountId, spaceId),
        eq(accountMemberships.memberId, principalId)
      )
    );
}
