import type { D1Database, R2Bucket } from '../../../shared/types/bindings.ts';
import type { Env, Repository, RepositoryVisibility, WorkspaceRole } from '../../../shared/types';
import { checkWorkspaceAccess } from '../../../shared/utils';
import { getDb, accounts, repositories } from '../../../infra/db';
import { and, desc, eq } from 'drizzle-orm';
import { isValidOpaqueId } from '../../../shared/utils/db-guards';
import { generateId, now } from '../../../shared/utils';
import * as gitStore from '../git-smart';
import { logError } from '../../../shared/utils/logger';

export interface RepoAccess {
  repo: Repository;
  spaceId: string;
  role: WorkspaceRole;
}

export interface CheckRepoAccessOptions {
  allowPublicRead?: boolean;
}

export interface CreateRepositoryInput {
  spaceId: string;
  name: string;
  description?: string | null;
  visibility?: RepositoryVisibility | 'internal';
  actorAccountId?: string;
}

export class RepositoryCreationError extends Error {
  constructor(
    message: string,
    public readonly code:
      | 'INVALID_NAME'
      | 'SPACE_NOT_FOUND'
      | 'REPOSITORY_EXISTS'
      | 'GIT_STORAGE_NOT_CONFIGURED'
      | 'INIT_FAILED',
  ) {
    super(message);
    this.name = 'RepositoryCreationError';
  }
}

function toRepositoryVisibility(value: string): RepositoryVisibility {
  return value === 'public' ? 'public' : 'private';
}

type RepositoryRow = typeof repositories.$inferSelect;

export function toApiRepositoryFromDb(row: RepositoryRow): Repository {
  const repository = {
    id: row.id,
    space_id: row.accountId,
    name: row.name,
    description: row.description,
    visibility: toRepositoryVisibility(row.visibility),
    default_branch: row.defaultBranch,
    forked_from_id: row.forkedFromId,
    stars: row.stars,
    forks: row.forks,
    git_enabled: row.gitEnabled,
    is_official: row.isOfficial,
    official_category: row.officialCategory,
    official_maintainer: row.officialMaintainer,
    featured: row.featured,
    install_count: row.installCount,
    created_at: row.createdAt,
    updated_at: row.updatedAt,
  };

  return repository;
}

export async function checkRepoAccess(
  env: Env,
  repoId: string,
  userId: string | null | undefined,
  requiredRoles?: WorkspaceRole[],
  options: CheckRepoAccessOptions = {},
): Promise<RepoAccess | null> {
  if (!isValidOpaqueId(repoId)) return null;

  const normalizedUserId = typeof userId === 'string' && isValidOpaqueId(userId)
    ? userId
    : null;

  const drizzle = getDb(env.DB);
  const row = await drizzle.select().from(repositories).where(eq(repositories.id, repoId)).get();
  const repo = row ? toApiRepositoryFromDb(row) : null;

  if (!repo) return null;

  if (normalizedUserId) {
    const access = await checkWorkspaceAccess(env.DB, repo.space_id, normalizedUserId, requiredRoles);
    if (access) {
      return { repo, spaceId: repo.space_id, role: access.member.role };
    }
  }

  if (options.allowPublicRead && !requiredRoles && repo.visibility === 'public') {
    return { repo, spaceId: repo.space_id, role: 'viewer' };
  }

  return null;
}

export async function getRepositoryById(db: D1Database, repoId: string): Promise<Repository | null> {
  if (!isValidOpaqueId(repoId)) return null;

  const drizzle = getDb(db);
  const row = await drizzle.select().from(repositories).where(eq(repositories.id, repoId)).get();
  return row ? toApiRepositoryFromDb(row) : null;
}

export async function listRepositoriesByWorkspace(db: D1Database, spaceId: string): Promise<Repository[]> {
  const drizzle = getDb(db);
  const rows = await drizzle.select().from(repositories)
    .where(eq(repositories.accountId, spaceId))
    .orderBy(desc(repositories.updatedAt))
    .all();
  return rows.map(toApiRepositoryFromDb);
}

export function sanitizeRepositoryName(name: string): string {
  return name.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '-');
}

async function resolveRepositoryInitActor(
  db: ReturnType<typeof getDb>,
  actorAccountId?: string,
): Promise<{ name: string; email: string }> {
  if (!actorAccountId) {
    return {
      name: 'Takos Agent',
      email: 'agent@users.takos.local',
    };
  }

  const actor = await db.select({
    name: accounts.name,
    slug: accounts.slug,
    email: accounts.email,
  }).from(accounts).where(eq(accounts.id, actorAccountId)).get();

  if (!actor) {
    return {
      name: 'Takos Agent',
      email: 'agent@users.takos.local',
    };
  }

  const fallbackLocalPart = actor.slug?.trim() || actorAccountId;

  return {
    name: actor.name || 'Takos Agent',
    email: actor.email || `${fallbackLocalPart}@users.takos.local`,
  };
}

export async function createRepository(
  dbBinding: D1Database,
  bucket: R2Bucket | undefined,
  input: CreateRepositoryInput,
): Promise<Repository> {
  const db = getDb(dbBinding);
  const name = sanitizeRepositoryName(input.name);

  if (!name) {
    throw new RepositoryCreationError('Invalid repository name', 'INVALID_NAME');
  }

  const workspace = await db.select({ id: accounts.id })
    .from(accounts)
    .where(eq(accounts.id, input.spaceId))
    .get();

  if (!workspace) {
    throw new RepositoryCreationError('Workspace not found', 'SPACE_NOT_FOUND');
  }

  const existing = await db.select({ id: repositories.id })
    .from(repositories)
    .where(and(
      eq(repositories.accountId, input.spaceId),
      eq(repositories.name, name),
    ))
    .get();

  if (existing) {
    throw new RepositoryCreationError('Repository with this name already exists', 'REPOSITORY_EXISTS');
  }

  if (!bucket) {
    throw new RepositoryCreationError('Git storage not configured', 'GIT_STORAGE_NOT_CONFIGURED');
  }

  const id = generateId();
  const timestamp = now();
  const actor = await resolveRepositoryInitActor(db, input.actorAccountId);

  await db.insert(repositories).values({
    id,
    accountId: input.spaceId,
    name,
    description: input.description || null,
    visibility: input.visibility || 'private',
    defaultBranch: 'main',
    stars: 0,
    forks: 0,
    gitEnabled: true,
    createdAt: timestamp,
    updatedAt: timestamp,
  });

  try {
    await gitStore.initRepository(dbBinding, bucket, id, 'main', {
      name: actor.name,
      email: actor.email,
      timestamp: Math.floor(new Date(timestamp).getTime() / 1000),
      tzOffset: '+0000',
    });
  } catch (error) {
    await db.delete(repositories).where(eq(repositories.id, id));
    logError('Failed to initialize repository', error, { module: 'services/source/repos' });
    throw new RepositoryCreationError('Failed to initialize repository', 'INIT_FAILED');
  }

  const row = await db.select().from(repositories).where(eq(repositories.id, id)).get();
  if (!row) {
    throw new RepositoryCreationError('Failed to create repository', 'INIT_FAILED');
  }

  return toApiRepositoryFromDb(row);
}
