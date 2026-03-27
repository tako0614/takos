import type { D1Database } from '../../../shared/types/bindings.ts';
import type { Env, Repository, Space, SecurityPosture } from '../../../shared/types';
import { generateId, now, slugifyName } from '../../../shared/utils';
import { isValidOpaqueId } from '../../../shared/utils/db-guards';
import { resolveUserPrincipalId } from './principals';
import { getDb, accounts, accountMemberships, repositories } from '../../../infra/db';
import { eq, and, or, desc } from 'drizzle-orm';

type RepoSummary = { id: string; name: string | null; default_branch: string | null };

export interface SpaceListItem {
  id: string;
  kind: 'user' | 'team' | 'system';
  name: string;
  slug: string | null;
  owner_principal_id: string;
  automation_principal_id?: string | null;
  head_snapshot_id?: string | null;
  security_posture: import('../../../shared/types').SecurityPosture;
  created_at: string;
  updated_at: string;
  member_role: import('../../../shared/types').SpaceRole;
  repository: RepoSummary | null;
}

function accountToWorkspace(row: {
  id: string;
  type: string;
  name: string;
  slug: string;
  description: string | null;
  ownerAccountId: string | null;
  headSnapshotId: string | null;
  aiModel: string | null;
  aiProvider: string | null;
  securityPosture: string | null;
  createdAt: string;
  updatedAt: string;
}): Space {
  const kind = row.type === 'user' ? 'user' : 'team';
  return {
    id: row.id,
    kind,
    name: row.name,
    slug: row.slug,
    description: row.description,
    owner_principal_id: row.ownerAccountId ?? row.id,
    head_snapshot_id: row.headSnapshotId,
    ai_model: row.aiModel,
    ai_provider: row.aiProvider,
    security_posture: row.securityPosture === 'restricted_egress' ? 'restricted_egress' : 'standard',
    created_at: row.createdAt,
    updated_at: row.updatedAt,
  };
}

function toRepository(row: {
  id: string;
  accountId: string;
  name: string;
  description: string | null;
  visibility: string;
  defaultBranch: string;
  forkedFromId: string | null;
  stars: number;
  forks: number;
  gitEnabled: boolean;
  createdAt: string;
  updatedAt: string;
}): Repository {
  return {
    id: row.id,
    space_id: row.accountId,
    name: row.name,
    description: row.description,
    visibility: row.visibility as Repository['visibility'],
    default_branch: row.defaultBranch,
    forked_from_id: row.forkedFromId,
    stars: row.stars,
    forks: row.forks,
    git_enabled: row.gitEnabled,
    created_at: row.createdAt,
    updated_at: row.updatedAt,
  };
}

export async function findLatestRepositoryBySpaceId(
  db: D1Database,
  spaceId: string
): Promise<RepoSummary | null> {
  const drizzle = getDb(db);
  const repo = await drizzle
    .select({
      id: repositories.id,
      name: repositories.name,
      default_branch: repositories.defaultBranch,
    })
    .from(repositories)
    .where(eq(repositories.accountId, spaceId))
    .orderBy(desc(repositories.updatedAt))
    .limit(1)
    .get();
  return repo || null;
}

async function generateUniqueSlug(db: D1Database, baseSlug: string, fallbackSuffix: string): Promise<string> {
  const drizzle = getDb(db);
  let slug = baseSlug;
  let suffix = 1;

  while (true) {
    const existing = await drizzle
      .select({ id: accounts.id })
      .from(accounts)
      .where(eq(accounts.slug, slug))
      .limit(1)
      .get();

    if (!existing) {
      return slug;
    }

    slug = `${baseSlug}-${suffix}`.slice(0, 32);
    suffix += 1;
    if (suffix > 100) {
      return `${baseSlug}-${fallbackSuffix}`.slice(0, 32);
    }
  }
}

async function loadOwnerPrincipalId(db: D1Database, ownerUserId: string): Promise<string> {
  const principalId = await resolveUserPrincipalId(db, ownerUserId);
  if (!principalId) {
    throw new Error(`Owner principal not found for user ${ownerUserId}`);
  }
  return principalId;
}

export async function loadSpaceById(db: D1Database, spaceId: string) {
  const drizzle = getDb(db);
  return drizzle
    .select()
    .from(accounts)
    .where(eq(accounts.id, spaceId))
    .limit(1)
    .get();
}

async function loadCanonicalSpaceByIdOrSlug(db: D1Database, idOrSlug: string) {
  const drizzle = getDb(db);
  return drizzle
    .select()
    .from(accounts)
    .where(or(eq(accounts.id, idOrSlug), eq(accounts.slug, idOrSlug)))
    .limit(1)
    .get();
}

async function createSpaceBundle(
  env: Env,
  params: {
    spaceId: string;
    kind: 'user' | 'team';
    name: string;
    slug: string;
    ownerUserId: string;
    ownerPrincipalId: string;
    description?: string | null;
    repoId: string;
    repoName: string;
    timestamp: string;
  }
): Promise<void> {
  const {
    spaceId,
    kind,
    name,
    slug,
    ownerUserId,
    ownerPrincipalId,
    description,
    repoId,
    repoName,
    timestamp,
  } = params;

  const drizzle = getDb(env.DB);

  // Create the space account (replaces the old spaces + principals inserts)
  await drizzle.insert(accounts).values({
    id: spaceId,
    type: kind,
    status: 'active',
    name,
    slug,
    description: description || null,
    ownerAccountId: ownerUserId,
    aiModel: 'gpt-5.4-nano',
    aiProvider: 'openai',
    securityPosture: 'standard',
    createdAt: timestamp,
    updatedAt: timestamp,
  });

  // Create the owner membership (replaces space_memberships insert)
  await drizzle.insert(accountMemberships).values({
    id: generateId(),
    accountId: spaceId,
    memberId: ownerPrincipalId,
    role: 'owner',
    status: 'active',
    updatedAt: timestamp,
    createdAt: timestamp,
  });

  // Create default repository
  await drizzle.insert(repositories).values({
    id: repoId,
    accountId: spaceId,
    name: repoName,
    description: `Default repository for ${name}`,
    visibility: 'private',
    defaultBranch: 'main',
    stars: 0,
    forks: 0,
    gitEnabled: false,
    createdAt: timestamp,
    updatedAt: timestamp,
  });
}

async function ensureSelfMembership(db: D1Database, userId: string): Promise<void> {
  const principalId = await resolveUserPrincipalId(db, userId);
  if (!principalId) return;

  const drizzle = getDb(db);
  const existing = await drizzle.select({ id: accountMemberships.id })
    .from(accountMemberships)
    .where(and(eq(accountMemberships.accountId, userId), eq(accountMemberships.memberId, principalId)))
    .limit(1)
    .get();
  if (!existing) {
    const timestamp = now();
    await drizzle.insert(accountMemberships).values({
      id: generateId(),
      accountId: userId,
      memberId: principalId,
      role: 'owner',
      status: 'active',
      createdAt: timestamp,
      updatedAt: timestamp,
    });
  }
}

export async function getRepositoryById(db: D1Database, repoId: string): Promise<Repository | null> {
  const drizzle = getDb(db);
  const repo = await drizzle
    .select()
    .from(repositories)
    .where(eq(repositories.id, repoId))
    .limit(1)
    .get();

  return repo ? toRepository(repo) : null;
}

export async function listWorkspacesForUser(
  env: Env,
  userId: string
): Promise<SpaceListItem[]> {
  if (!isValidOpaqueId(userId)) {
    return [];
  }

  const principalId = await resolveUserPrincipalId(env.DB, userId);
  if (!principalId) {
    return [];
  }

  const drizzle = getDb(env.DB);

  const memberships = await drizzle
    .select({
      memberRole: accountMemberships.role,
      spaceId: accounts.id,
      spaceType: accounts.type,
      spaceName: accounts.name,
      spaceSlug: accounts.slug,
      spaceOwnerAccountId: accounts.ownerAccountId,
      spaceHeadSnapshotId: accounts.headSnapshotId,
      spaceSecurityPosture: accounts.securityPosture,
      spaceCreatedAt: accounts.createdAt,
      spaceUpdatedAt: accounts.updatedAt,
    })
    .from(accountMemberships)
    .innerJoin(accounts, eq(accounts.id, accountMemberships.accountId))
    .where(eq(accountMemberships.memberId, principalId))
    .orderBy(desc(accounts.updatedAt))
    .all();

  if (memberships.length === 0) {
    return [];
  }

  const latestRepoBySpace = new Map<string, RepoSummary | null>();
  for (const membership of memberships) {
    if (!latestRepoBySpace.has(membership.spaceId)) {
      latestRepoBySpace.set(
        membership.spaceId,
        await findLatestRepositoryBySpaceId(env.DB, membership.spaceId)
      );
    }
  }

  return memberships.map((membership) => ({
    id: membership.spaceId,
    kind: (membership.spaceType === 'user' ? 'user' : 'team') as 'user' | 'team',
    name: membership.spaceName,
    slug: membership.spaceSlug,
    owner_principal_id: membership.spaceOwnerAccountId ?? membership.spaceId,
    automation_principal_id: null,
    head_snapshot_id: membership.spaceHeadSnapshotId,
    security_posture: membership.spaceSecurityPosture === 'restricted_egress' ? 'restricted_egress' : 'standard',
    created_at: membership.spaceCreatedAt,
    updated_at: membership.spaceUpdatedAt,
    member_role: membership.memberRole as import('../../../shared/types').SpaceRole,
    repository: latestRepoBySpace.get(membership.spaceId) ?? null,
  }));
}

export async function createWorkspaceWithDefaultRepo(
  env: Env,
  userId: string,
  name: string,
  options?: { id?: string; skipIdCheck?: boolean; kind?: 'team'; description?: string }
): Promise<{ workspace: Space; repository: Repository | null }> {
  const spaceId = options?.id || generateId();
  const repoId = generateId();
  const timestamp = now();
  const kind = options?.kind || 'team';
  const trimmedName = name.trim();
  const slug = await generateUniqueSlug(env.DB, slugifyName(trimmedName), spaceId.slice(0, 6));
  const ownerPrincipalId = await loadOwnerPrincipalId(env.DB, userId);

  if (!options?.skipIdCheck) {
    const drizzle = getDb(env.DB);
    const existing = await drizzle
      .select({ id: accounts.id })
      .from(accounts)
      .where(eq(accounts.id, spaceId))
      .limit(1)
      .get();
    if (existing) {
      throw new Error('Space ID already exists');
    }
  }

  await createSpaceBundle(env, {
    spaceId,
    kind,
    name: trimmedName,
    slug,
    ownerUserId: userId,
    ownerPrincipalId,
    description: options?.description ?? null,
    repoId,
    repoName: 'main',
    timestamp,
  });

  const space = await loadSpaceById(env.DB, spaceId);
  const repository = await getRepositoryById(env.DB, repoId);
  if (!space) {
    throw new Error('Failed to load created space');
  }

  return { workspace: accountToWorkspace(space), repository };
}

export async function getWorkspaceWithRepository(
  env: Env,
  workspace: Space
): Promise<{ workspace: Space; repository: Repository | null }> {
  return {
    workspace,
    repository: await findLatestRepositoryBySpaceId(env.DB, workspace.id).then((repo) => {
      if (!repo) return null;
      return {
        id: repo.id,
        space_id: workspace.id,
        name: repo.name || 'main',
        description: null,
        visibility: 'private',
        default_branch: repo.default_branch || 'main',
        forked_from_id: null,
        stars: 0,
        forks: 0,
        git_enabled: false,
        created_at: workspace.created_at,
        updated_at: workspace.updated_at,
      } satisfies Repository;
    }),
  };
}

export async function updateWorkspace(
  db: D1Database,
  spaceId: string,
  updates: { name?: string; ai_model?: string; ai_provider?: string; security_posture?: SecurityPosture }
): Promise<Space | null> {
  const current = await loadSpaceById(db, spaceId);
  if (!current) return null;

  const nextName = updates.name ?? current.name;
  const nextModel = updates.ai_model ?? current.aiModel;
  const nextProvider = updates.ai_provider ?? current.aiProvider;
  const nextSecurityPosture = updates.security_posture ?? (current.securityPosture === 'restricted_egress' ? 'restricted_egress' : 'standard');
  const timestamp = now();

  const drizzle = getDb(db);
  await drizzle
    .update(accounts)
    .set({
      name: nextName,
      aiModel: nextModel,
      aiProvider: nextProvider,
      securityPosture: nextSecurityPosture,
      updatedAt: timestamp,
    })
    .where(eq(accounts.id, spaceId));

  const updated = await loadSpaceById(db, spaceId);
  return updated ? accountToWorkspace(updated) : null;
}

export async function getWorkspaceByIdOrSlug(
  db: D1Database,
  idOrSlug: string
): Promise<Space | null> {
  const row = await loadCanonicalSpaceByIdOrSlug(db, idOrSlug);
  return row ? accountToWorkspace(row) : null;
}

export async function deleteWorkspace(db: D1Database, spaceId: string): Promise<void> {
  const drizzle = getDb(db);
  await drizzle.delete(accounts).where(eq(accounts.id, spaceId));
}

export async function getPersonalWorkspace(
  env: Env,
  userId: string
): Promise<SpaceListItem | null> {
  const drizzle = getDb(env.DB);
  const userAccount = await drizzle.select().from(accounts)
    .where(and(eq(accounts.id, userId), eq(accounts.type, 'user')))
    .limit(1)
    .get();
  if (!userAccount) return null;

  // Ensure self-membership exists
  await ensureSelfMembership(env.DB, userId);

  const repo = await findLatestRepositoryBySpaceId(env.DB, userId);
  return {
    id: userAccount.id,
    kind: 'user',
    name: userAccount.name,
    slug: userAccount.slug,
    owner_principal_id: userAccount.id,
    automation_principal_id: null,
    head_snapshot_id: userAccount.headSnapshotId,
    security_posture: userAccount.securityPosture === 'restricted_egress' ? 'restricted_egress' : 'standard',
    created_at: userAccount.createdAt,
    updated_at: userAccount.updatedAt,
    member_role: 'owner',
    repository: repo,
  };
}

export async function getOrCreatePersonalWorkspace(
  env: Env,
  userId: string
): Promise<SpaceListItem | null> {
  return getPersonalWorkspace(env, userId);
}

export async function ensurePersonalWorkspace(
  env: Env,
  userId: string
): Promise<boolean> {
  await ensureSelfMembership(env.DB, userId);
  return true;
}
