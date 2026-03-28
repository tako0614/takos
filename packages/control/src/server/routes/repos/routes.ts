import { Hono } from 'hono';
import type { Context } from 'hono';
import { z } from 'zod';
import type { RepositoryVisibility } from '../../../shared/types';
import { now, toIsoString } from '../../../shared/utils';
import {
  requireSpaceAccess,
} from '../shared/route-auth';
import { AppError, ErrorCodes, BadRequestError, ConflictError, InternalError, NotFoundError, ValidationError } from '@takoserver/common/errors';
import type { AuthenticatedRouteEnv } from '../shared/route-auth';
import { zValidator } from '../zod-validator';
import * as gitStore from '../../../application/services/git-smart';
import type { ResolveReadableCommitResult } from '../../../application/services/git-smart';
import { collectReachableObjectShas } from '../../../application/services/git-smart';
import {
  checkRepoAccess,
  createRepository,
  listRepositoriesBySpace,
  RepositoryCreationError,
} from '../../../application/services/source/repos';
import { getDb } from '../../../infra/db';
import type { Database } from '../../../infra/db';
import { accounts, repositories, branches, repoForks, repoRemotes, repoStars, workflowSecrets } from '../../../infra/db/schema';
import { and, eq, ne, sql } from 'drizzle-orm';
import { invalidateCacheOnMutation } from '../../middleware/cache';
import { logError, logWarn } from '../../../shared/utils/logger';

// --- Shared repo utilities (formerly repos/utils.ts) ---

export type RepoBucketBinding = NonNullable<AuthenticatedRouteEnv['Bindings']['GIT_OBJECTS']>;
export type GitBucket = Parameters<typeof gitStore.getCommit>[1];

export function toGitBucket(bucket: RepoBucketBinding): GitBucket {
  return bucket as unknown as GitBucket;
}

export { sanitizeRepoName } from '../../../shared/utils';

export function readableCommitErrorResponse(
  c: Context,
  ref: string,
  result: Extract<ResolveReadableCommitResult, { ok: false }>
): Response {
  if (result.reason === 'ref_not_found') {
    throw new NotFoundError('Ref');
  }

  if (result.reason === 'commit_not_found') {
    return c.json({
      error: 'Commit object missing',
      ref,
      commit_sha: result.refCommitSha || null,
    }, 409);
  }

  return c.json({
    error: 'Commit tree missing',
    ref,
    commit_sha: result.refCommitSha || null,
  }, 409);
}

export function generateExploreInvalidationUrls(c: Context): string[] {
  const origin = new URL(c.req.url).origin;

  return [
    `${origin}/explore/repos`,
    `${origin}/explore/repos/trending`,
    `${origin}/explore/repos/new`,
    `${origin}/explore/repos/recent`,
    `${origin}/explore/suggest`,
    `${origin}/explore/packages`,
    `${origin}/explore/users`,
  ];
}

export function encodeBase64(data: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < data.length; i++) {
    binary += String.fromCharCode(data[i]);
  }
  return btoa(binary);
}

export function hasWriteRole(role: string | null | undefined): boolean {
  return role === 'owner' || role === 'admin' || role === 'editor';
}

export type TreeFlattenLimitErrorCode =
  | 'TREE_FLATTEN_ENTRY_LIMIT_EXCEEDED'
  | 'TREE_FLATTEN_DEPTH_LIMIT_EXCEEDED';

/**
 * Check whether an error is a tree flatten limit error.
 * Shared across git, git-advanced, and sync routes.
 */
export function getTreeFlattenLimitError(
  err: unknown
): { code: TreeFlattenLimitErrorCode; detail: string } | null {
  if (!(err instanceof Error)) {
    return null;
  }
  if (err.message.includes('Tree flatten entry limit exceeded')) {
    return { code: 'TREE_FLATTEN_ENTRY_LIMIT_EXCEEDED', detail: err.message };
  }
  if (err.message.includes('Tree flatten depth limit exceeded')) {
    return { code: 'TREE_FLATTEN_DEPTH_LIMIT_EXCEEDED', detail: err.message };
  }
  return null;
}

// --- End shared repo utilities ---

const MAX_REPO_OBJECT_CLEANUP_CANDIDATES = 25_000;
type GitObjectsBucket = NonNullable<AuthenticatedRouteEnv['Bindings']['GIT_OBJECTS']>;
type ReachableObjectsBucket = Parameters<typeof collectReachableObjectShas>[1];
type DeleteBucket = Parameters<typeof gitStore.deleteObject>[0];

type RepositoryResponseSource = {
  name: string;
  description: string | null;
  visibility: string;
  defaultBranch: string;
  stars: number;
  forks: number;
  gitEnabled: number | boolean;
  createdAt: string | Date;
  updatedAt: string | Date;
};
/**
 * Resolve the display username for an account (workspace or user).
 * The account's own slug is the username — no personal workspace indirection needed.
 */
async function resolveOwnerUsername(db: Database, spaceId: string): Promise<string> {
  const workspace = await db.select({
    slug: accounts.slug,
  })
    .from(accounts)
    .where(eq(accounts.id, spaceId))
    .get();

  return workspace?.slug || '';
}

function formatRepositoryResponse(
  repository: RepositoryResponseSource,
  ownerUsername: string
) {
  return {
    owner_username: ownerUsername,
    name: repository.name,
    description: repository.description,
    visibility: repository.visibility as RepositoryVisibility,
    default_branch: repository.defaultBranch,
    stars: repository.stars,
    forks: repository.forks,
    git_enabled: repository.gitEnabled,
    created_at: toIsoString(repository.createdAt),
    updated_at: toIsoString(repository.updatedAt),
  };
}

async function deleteR2Prefix(
  bucket: GitObjectsBucket,
  prefix: string
): Promise<void> {
  let cursor: string | undefined;

  do {
    const listing = await bucket.list({ prefix, cursor });
    if (listing.objects.length > 0) {
      await Promise.all(listing.objects.map((object: { key: string }) => bucket.delete(object.key)));
    }
    cursor = listing.truncated ? listing.cursor : undefined;
  } while (cursor);
}

async function cleanupRepoGitObjects(
  db: Database,
  d1: AuthenticatedRouteEnv['Bindings']['DB'],
  bucket: GitObjectsBucket,
  deletedRepoId: string,
  candidateOids: Set<string>
): Promise<void> {
  if (candidateOids.size === 0) {
    return;
  }

  const candidateList = Array.from(candidateOids);
  const sharedOids = new Set<string>();
  const otherRepos = await db.select({ id: repositories.id })
    .from(repositories)
    .where(ne(repositories.id, deletedRepoId))
    .all();

  for (const repo of otherRepos) {
    if (sharedOids.size === candidateList.length) {
      break;
    }

    const reachable = await collectReachableObjectShas(
      d1,
      bucket as ReachableObjectsBucket,
      repo.id
    );
    for (const oid of candidateList) {
      if (!sharedOids.has(oid) && reachable.has(oid)) {
        sharedOids.add(oid);
      }
    }
  }

  const deletable = candidateList.filter((oid) => !sharedOids.has(oid));
  if (deletable.length === 0) {
    return;
  }

  const chunkSize = 100;
  for (let i = 0; i < deletable.length; i += chunkSize) {
    const chunk = deletable.slice(i, i + chunkSize);
    await Promise.allSettled(chunk.map((oid) => gitStore.deleteObject(bucket as DeleteBucket, oid)));
  }
}


export default new Hono<AuthenticatedRouteEnv>()
  .post('/spaces/:spaceId/repos', invalidateCacheOnMutation([generateExploreInvalidationUrls]), zValidator('json', z.object({
    name: z.string().min(1, 'Repository name is required'),
    description: z.string().optional(),
    visibility: z.enum(['public', 'private', 'internal']).optional(),
  })), async (c) => {
  const user = c.get('user');
  const spaceIdentifier = c.req.param('spaceId');
  const body = c.req.valid('json');

  const access = await requireSpaceAccess(
    c,
    spaceIdentifier,
    user.id,
    ['owner', 'admin', 'editor'],
    'Workspace not found or insufficient permissions'
  );
  const spaceId = access.space.id;

  const db = getDb(c.env.DB);
  let createdRepository;
  try {
    createdRepository = await createRepository(c.env.DB, c.env.GIT_OBJECTS, {
      spaceId,
      name: body.name,
      description: body.description || null,
      visibility: body.visibility || 'private',
      actorAccountId: user.id,
    });
  } catch (err) {
    if (err instanceof RepositoryCreationError) {
      switch (err.code) {
        case 'INVALID_NAME':
          throw new BadRequestError(err.message);
        case 'SPACE_NOT_FOUND':
          throw new AppError(err.message, ErrorCodes.NOT_FOUND, 404);
        case 'REPOSITORY_EXISTS':
          throw new ConflictError(err.message);
        case 'GIT_STORAGE_NOT_CONFIGURED':
        case 'INIT_FAILED':
          throw new InternalError(err.message);
      }
    }
    logError('Failed to create repository', err, { action: 'createRepository', userId: user.id, spaceId });
    // Handle database constraint errors inline (replaces handleDbError)
    const errStr = String(err);
    if (errStr.includes('UNIQUE constraint')) throw new ConflictError('workspace already exists');
    if (errStr.includes('FOREIGN KEY constraint')) throw new BadRequestError('Referenced workspace does not exist');
    if (errStr.includes('NOT NULL constraint')) throw new ValidationError('Required field is missing');
    throw new InternalError('Database operation failed');
  }

  const ownerUsername = await resolveOwnerUsername(db, createdRepository.space_id);

  const repositoryResponse = formatRepositoryResponse(
    {
      name: createdRepository.name,
      description: createdRepository.description,
      visibility: createdRepository.visibility,
      defaultBranch: createdRepository.default_branch,
      stars: createdRepository.stars,
      forks: createdRepository.forks,
      gitEnabled: createdRepository.git_enabled,
      createdAt: createdRepository.created_at,
      updatedAt: createdRepository.updated_at,
    },
    ownerUsername || user.username
  );

  return c.json({ repository: repositoryResponse }, 201);
  })
  .get('/spaces/:spaceId/repos', async (c) => {
  const user = c.get('user');
  const spaceIdentifier = c.req.param('spaceId');
  const db = getDb(c.env.DB);

  const access = await requireSpaceAccess(c, spaceIdentifier, user.id);
  const spaceId = access.space.id;

  const ownerUsername = await resolveOwnerUsername(db, spaceId);

  const reposData = await listRepositoriesBySpace(c.env.DB, spaceId);

  const reposList = reposData.map((repo) => ({
    id: repo.id,
    owner_username: ownerUsername,
    owner: ownerUsername ? { username: ownerUsername } : undefined,
    name: repo.name,
    description: repo.description,
    visibility: repo.visibility,
    default_branch: repo.default_branch,
    stars: repo.stars,
    forks: repo.forks,
    git_enabled: repo.git_enabled,
    created_at: repo.created_at,
    updated_at: repo.updated_at,
  }));

  return c.json({ repositories: reposList });
  })
  .get('/repos/:repoId', async (c) => {
  const user = c.get('user');
  const repoId = c.req.param('repoId');
  const db = getDb(c.env.DB);

  const repoAccess = await checkRepoAccess(
    c.env,
    repoId,
    user?.id,
    undefined,
    { allowPublicRead: true },
  );
  if (!repoAccess) {
    throw new NotFoundError('Repository');
  }

  const repoResult = await db.select().from(repositories).where(eq(repositories.id, repoId)).get();

  if (!repoResult) {
    throw new NotFoundError('Repository');
  }

  const userRole = user?.id ? repoAccess.role : null;

  let branchCount = 0;
  try {
    const branchesList = await gitStore.listBranches(c.env.DB, repoId);
    branchCount = branchesList.length;
  } catch (err) {
    logError('Failed to get branch count', err, { action: 'getRepo', repoId });
  }

  const star = user?.id
    ? await db.select({ accountId: repoStars.accountId })
        .from(repoStars)
        .where(and(eq(repoStars.accountId, user.id), eq(repoStars.repoId, repoId)))
        .get()
    : null;

  const workspaceData = await db.select({
    id: accounts.id,
    name: accounts.name,
    slug: accounts.slug,
    picture: accounts.picture,
  })
    .from(accounts)
    .where(eq(accounts.id, repoResult.accountId))
    .get();

  const ownerName = await resolveOwnerUsername(db, repoResult.accountId);

  const repository = formatRepositoryResponse(
    repoResult,
    ownerName || workspaceData?.id || ''
  );

  return c.json({
    repository,
    branch_count: branchCount,
    starred: !!star,
    user_role: userRole,
    workspace: workspaceData ? { name: workspaceData.name } : null,
    owner: workspaceData ? {
      name: workspaceData.name,
      picture: workspaceData.picture || null,
    } : null,
  });
  })
  .patch('/repos/:repoId', invalidateCacheOnMutation([generateExploreInvalidationUrls]), zValidator('json', z.object({
    name: z.string().min(1, 'Repository name must not be empty').optional(),
    description: z.string().optional(),
    visibility: z.enum(['public', 'private', 'internal']).optional(),
    default_branch: z.string().min(1, 'default_branch must not be empty').optional(),
  })), async (c) => {
  const user = c.get('user');
  const repoId = c.req.param('repoId');
  const body = c.req.valid('json');

  const repoAccess = await checkRepoAccess(c.env, repoId, user.id, ['owner', 'admin']);
  if (!repoAccess) {
    throw new NotFoundError('Repository');
  }

  const db = getDb(c.env.DB);
  const data: Record<string, string | number> = {};

  if (body.description !== undefined) {
    data.description = body.description;
  }

  if (body.visibility) {
    data.visibility = body.visibility;
  }

  if (body.default_branch !== undefined) {
    const nextDefaultBranch = body.default_branch.trim();
    if (!gitStore.isValidRefName(nextDefaultBranch)) {
      throw new BadRequestError('Invalid default_branch');
    }
    const existingBranch = await gitStore.getBranch(c.env.DB, repoId, nextDefaultBranch);
    if (!existingBranch) {
      throw new BadRequestError('default_branch does not exist');
    }
    data.defaultBranch = nextDefaultBranch;
  }

  if (Object.keys(data).length === 0) {
    throw new BadRequestError('No valid updates provided');
  }

  const timestamp = now();
  data.updatedAt = timestamp;

  const updatedRepoArr = await db.update(repositories)
    .set(data)
    .where(eq(repositories.id, repoId))
    .returning();
  const updatedRepo = updatedRepoArr[0];

  const updatedOwnerUsername = await resolveOwnerUsername(db, updatedRepo.accountId);

  const repository = formatRepositoryResponse(
    updatedRepo,
    updatedOwnerUsername || updatedRepo.accountId
  );

  return c.json({ repository });
  })
  .delete('/repos/:repoId', invalidateCacheOnMutation([generateExploreInvalidationUrls]), async (c) => {
  const user = c.get('user');
  const repoId = c.req.param('repoId');
  const db = getDb(c.env.DB);

  const repoAccess = await checkRepoAccess(c.env, repoId, user.id, ['owner', 'admin']);
  if (!repoAccess) {
    throw new NotFoundError('Repository');
  }

  let repoObjectCandidates: Set<string> | null = null;
  if (c.env.GIT_OBJECTS) {
    try {
      const reachable = await collectReachableObjectShas(c.env.DB, c.env.GIT_OBJECTS, repoId);
      if (reachable.size <= MAX_REPO_OBJECT_CLEANUP_CANDIDATES) {
        repoObjectCandidates = reachable;
      } else {
        logWarn('Skipping git object cleanup due to oversized candidate set', {
          action: 'deleteRepository',
          repoId,
          size: reachable.size,
          max: MAX_REPO_OBJECT_CLEANUP_CANDIDATES,
        });
      }
    } catch (error) {
      logWarn('Failed to collect reachable objects before repo deletion', { action: 'deleteRepository', repoId });
    }
  }

  await db.delete(branches).where(eq(branches.repoId, repoId));
  await db.delete(repoForks).where(eq(repoForks.forkRepoId, repoId));
  await db.delete(repoRemotes).where(eq(repoRemotes.repoId, repoId));
  await db.delete(workflowSecrets).where(eq(workflowSecrets.repoId, repoId));
  await db.delete(repositories).where(eq(repositories.id, repoId));

  if (repoAccess.repo.forked_from_id) {
    await db.update(repositories)
      .set({ forks: sql`${repositories.forks} - 1` })
      .where(eq(repositories.id, repoAccess.repo.forked_from_id));
  }

  if (c.env.GIT_OBJECTS) {
    c.executionCtx.waitUntil((async () => {
      try {
        await deleteR2Prefix(c.env.GIT_OBJECTS!, `release-assets/${repoId}/`);
      } catch (error) {
        logWarn('Failed to cleanup release assets', { action: 'deleteRepository', repoId });
      }

      if (!repoObjectCandidates || repoObjectCandidates.size === 0) {
        return;
      }

      try {
        await cleanupRepoGitObjects(
          db,
          c.env.DB,
          c.env.GIT_OBJECTS! as unknown as DeleteBucket,
          repoId,
          repoObjectCandidates
        );
      } catch (error) {
        logWarn('Failed to cleanup repo git objects', { action: 'deleteRepository', repoId });
      }
    })());
  }

  return c.json({ success: true });
  });
