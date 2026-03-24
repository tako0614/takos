import type { D1Database } from '../../../shared/types/bindings.ts';
import type { Env, Repository, User, Workspace, WorkspaceMember, WorkspaceRole, SecurityPosture } from '../../../shared/types';
import { generateId, now, slugifyName } from '../../../shared/utils';
import { isValidOpaqueId } from '../../../shared/utils/db-guards';
import { resolveActorPrincipalId, resolveUserPrincipalId } from './principals';
import { getDb, accounts, accountMemberships, repositories } from '../../../infra/db';
import { eq, and, or, desc } from 'drizzle-orm';

type RepoSummary = { id: string; name: string | null; default_branch: string | null };

interface ModelSettings {
  ai_model: string | null;
  ai_provider: string | null;
}

interface MemberListItem {
  username: string;
  email: string;
  name: string;
  picture: string | null;
  role: string;
  created_at: string;
}

export interface WorkspaceListItem {
  id: string;
  kind: 'user' | 'team' | 'system';
  name: string;
  slug: string | null;
  owner_principal_id: string;
  automation_principal_id?: string | null;
  head_snapshot_id?: string | null;
  security_posture: SecurityPosture;
  created_at: string;
  updated_at: string;
  member_role: WorkspaceRole;
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
}): Workspace {
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

async function findLatestRepositoryBySpaceId(
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

async function loadSpaceById(db: D1Database, spaceId: string) {
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

async function resolveMembershipPrincipalId(db: D1Database, actorId: string): Promise<string> {
  const principalId = await resolveActorPrincipalId(db, actorId);
  if (!principalId) {
    throw new Error(`Principal not found for actor ${actorId}`);
  }
  return principalId;
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
): Promise<WorkspaceListItem[]> {
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
    member_role: membership.memberRole as WorkspaceRole,
    repository: latestRepoBySpace.get(membership.spaceId) ?? null,
  }));
}

export async function createWorkspaceWithDefaultRepo(
  env: Env,
  userId: string,
  name: string,
  options?: { id?: string; skipIdCheck?: boolean; kind?: 'team'; description?: string }
): Promise<{ workspace: Workspace; repository: Repository | null }> {
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
  workspace: Workspace
): Promise<{ workspace: Workspace; repository: Repository | null }> {
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
): Promise<Workspace | null> {
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
): Promise<Workspace | null> {
  const row = await loadCanonicalSpaceByIdOrSlug(db, idOrSlug);
  return row ? accountToWorkspace(row) : null;
}

export async function getWorkspaceModelSettings(
  db: D1Database,
  spaceId: string
): Promise<ModelSettings | null> {
  if (!isValidOpaqueId(spaceId)) {
    return null;
  }

  const drizzle = getDb(db);
  const row = await drizzle
    .select({
      ai_model: accounts.aiModel,
      ai_provider: accounts.aiProvider,
      security_posture: accounts.securityPosture,
    })
    .from(accounts)
    .where(eq(accounts.id, spaceId))
    .limit(1)
    .get();

  return row || null;
}

export async function updateWorkspaceModel(
  db: D1Database,
  spaceId: string,
  model: string,
  provider: string
): Promise<void> {
  const drizzle = getDb(db);
  await drizzle
    .update(accounts)
    .set({
      aiModel: model,
      aiProvider: provider,
      updatedAt: now(),
    })
    .where(eq(accounts.id, spaceId));
}

export async function deleteWorkspace(db: D1Database, spaceId: string): Promise<void> {
  const drizzle = getDb(db);
  await drizzle.delete(accounts).where(eq(accounts.id, spaceId));
}

export async function listWorkspaceMembers(
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

export async function getWorkspaceMember(
  db: D1Database,
  spaceId: string,
  actorId: string
): Promise<WorkspaceMember | null> {
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
    role: row.role as WorkspaceRole,
    created_at: row.createdAt,
  };
}

export async function createWorkspaceMember(
  db: D1Database,
  spaceId: string,
  actorId: string,
  role: WorkspaceRole
): Promise<{ role: WorkspaceRole; created_at: string }> {
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

export async function updateWorkspaceMemberRole(
  db: D1Database,
  spaceId: string,
  actorId: string,
  role: WorkspaceRole
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

export async function deleteWorkspaceMember(
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

export async function getPersonalWorkspace(
  env: Env,
  userId: string
): Promise<WorkspaceListItem | null> {
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
): Promise<WorkspaceListItem | null> {
  return getPersonalWorkspace(env, userId);
}

export async function ensurePersonalWorkspace(
  env: Env,
  userId: string
): Promise<boolean> {
  await ensureSelfMembership(env.DB, userId);
  return true;
}
