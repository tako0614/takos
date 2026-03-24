import type { D1Database } from '../../../shared/types/bindings.ts';
import { and, count, eq, inArray, sql } from 'drizzle-orm';
import { getDb } from '../../../infra/db';
import { accountFollows, accountMutes, accountSettings, accounts, repositories, repoStars } from '../../../infra/db/schema';
import type { Repository, Workspace } from '../../../shared/types';
import { checkWorkspaceAccess } from '../../../shared/utils';

export interface ProfileUser {
  id: string;
  email: string;
  name: string;
  picture: string | null;
  username: string;
  bio: string | null;
  created_at: string;
  updated_at: string;
}

export async function getUserByUsername(
  dbBinding: D1Database,
  username: string
): Promise<ProfileUser | null> {
  const cleanUsername = username.replace(/^@+/, '').trim().toLowerCase();
  if (!cleanUsername) {
    return null;
  }

  const db = getDb(dbBinding);
  const row = await db.select().from(accounts)
    .where(eq(accounts.slug, cleanUsername))
    .limit(1)
    .get();

  if (!row) {
    return null;
  }

  return {
    id: row.id,
    email: row.email ?? '',
    name: row.name,
    picture: row.picture,
    username: row.slug,
    bio: row.bio,
    created_at: row.createdAt,
    updated_at: row.updatedAt,
  };
}

export async function getUserStats(dbBinding: D1Database, userId: string): Promise<{
  public_repo_count: number;
  followers_count: number;
  following_count: number;
}> {
  const db = getDb(dbBinding);

  const [repoCountRow, followersCountRow, followingCountRow] = await Promise.all([
    db.select({ count: count() }).from(repositories).where(and(
      eq(repositories.accountId, userId),
      eq(repositories.visibility, 'public'),
    )).get(),
    db.select({ count: count() }).from(accountFollows).where(eq(accountFollows.followingAccountId, userId)).get(),
    db.select({ count: count() }).from(accountFollows).where(eq(accountFollows.followerAccountId, userId)).get(),
  ]);

  return {
    public_repo_count: repoCountRow?.count ?? 0,
    followers_count: followersCountRow?.count ?? 0,
    following_count: followingCountRow?.count ?? 0,
  };
}

export async function isFollowing(
  dbBinding: D1Database,
  currentUserId: string | undefined,
  targetUserId: string
): Promise<boolean> {
  if (!currentUserId) {
    return false;
  }

  const db = getDb(dbBinding);
  const row = await db.select({ followerAccountId: accountFollows.followerAccountId })
    .from(accountFollows)
    .where(and(
      eq(accountFollows.followerAccountId, currentUserId),
      eq(accountFollows.followingAccountId, targetUserId),
    ))
    .limit(1)
    .get();

  return !!row;
}

export type ActivityVisibility = 'public' | 'followers' | 'private';
const ACTIVITY_VISIBILITY_VALUES: readonly ActivityVisibility[] = ['public', 'followers', 'private'];

export async function getUserPrivacySettings(
  dbBinding: D1Database,
  userId: string
): Promise<{ private_account: boolean; activity_visibility: ActivityVisibility }> {
  const db = getDb(dbBinding);
  const row = await db.select({
    privateAccount: accountSettings.privateAccount,
    activityVisibility: accountSettings.activityVisibility,
  }).from(accountSettings)
    .where(eq(accountSettings.accountId, userId))
    .limit(1)
    .get();

  const privateAccount = !!row?.privateAccount;
  const visRaw = (row?.activityVisibility ?? 'public').toLowerCase();
  const activityVisibility = (ACTIVITY_VISIBILITY_VALUES as readonly string[]).includes(visRaw)
    ? (visRaw as ActivityVisibility)
    : 'public';

  return { private_account: privateAccount, activity_visibility: activityVisibility };
}

export async function isMutedBy(
  dbBinding: D1Database,
  muterId: string,
  mutedId: string
): Promise<boolean> {
  const db = getDb(dbBinding);
  const row = await db.select({ muterAccountId: accountMutes.muterAccountId })
    .from(accountMutes)
    .where(and(
      eq(accountMutes.muterAccountId, muterId),
      eq(accountMutes.mutedAccountId, mutedId),
    ))
    .limit(1)
    .get();

  return !!row;
}

export async function batchStarCheck(
  dbBinding: D1Database,
  currentUserId: string | undefined,
  repoIds: string[]
): Promise<Set<string>> {
  if (!currentUserId || repoIds.length === 0) {
    return new Set<string>();
  }

  const db = getDb(dbBinding);
  const rows = await db.select({ repoId: repoStars.repoId })
    .from(repoStars)
    .where(and(
      eq(repoStars.accountId, currentUserId),
      inArray(repoStars.repoId, repoIds),
    ))
    .all();

  return new Set(rows.map((row) => row.repoId));
}

export async function findRepoByUsernameAndName(
  dbBinding: D1Database,
  username: string,
  repoName: string,
  currentUserId?: string
): Promise<{ repo: Repository; workspace: Workspace; owner: ProfileUser } | null> {
  const owner = await getUserByUsername(dbBinding, username);
  if (!owner) {
    return null;
  }

  const cleanRepoName = repoName.trim().toLowerCase();
  const db = getDb(dbBinding);

  const repoData = await db.select().from(repositories)
    .where(and(
      eq(repositories.accountId, owner.id),
      sql`lower(${repositories.name}) = ${cleanRepoName}`,
    ))
    .limit(1)
    .get();

  if (!repoData) {
    return null;
  }

  const repo: Repository = {
    id: repoData.id,
    space_id: repoData.accountId,
    name: repoData.name,
    description: repoData.description,
    visibility: repoData.visibility as Repository['visibility'],
    default_branch: repoData.defaultBranch,
    forked_from_id: repoData.forkedFromId,
    stars: repoData.stars,
    forks: repoData.forks,
    git_enabled: repoData.gitEnabled,
    created_at: repoData.createdAt,
    updated_at: repoData.updatedAt,
  };

  const workspaceData = await db.select().from(accounts)
    .where(eq(accounts.id, owner.id))
    .limit(1)
    .get();

  if (!workspaceData) {
    return null;
  }

  const kind: Workspace['kind'] = workspaceData.type === 'user'
    ? 'user'
    : workspaceData.type === 'system'
      ? 'system'
      : 'team';

  const workspace: Workspace = {
    id: workspaceData.id,
    kind,
    name: workspaceData.name,
    slug: workspaceData.slug,
    description: workspaceData.description,
    principal_id: workspaceData.id,
    owner_user_id: workspaceData.type === 'user' ? workspaceData.id : (workspaceData.ownerAccountId ?? workspaceData.id),
    owner_principal_id: workspaceData.type === 'user' ? workspaceData.id : (workspaceData.ownerAccountId ?? workspaceData.id),
    automation_principal_id: null,
    head_snapshot_id: workspaceData.headSnapshotId,
    ai_model: workspaceData.aiModel,
    ai_provider: workspaceData.aiProvider,
    security_posture: workspaceData.securityPosture === 'restricted_egress' ? 'restricted_egress' : 'standard',
    created_at: workspaceData.createdAt,
    updated_at: workspaceData.updatedAt,
  };

  if (repo.visibility === 'private') {
    if (!currentUserId) {
      return null;
    }

    const access = await checkWorkspaceAccess(dbBinding, workspace.id, currentUserId);
    if (!access) {
      return null;
    }
  }

  return { repo, workspace, owner };
}
