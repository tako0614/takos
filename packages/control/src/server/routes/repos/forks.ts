import { Hono } from 'hono';
import type { D1Database } from '../../../shared/types/bindings.ts';
import { z } from 'zod';
import type { Repository } from '../../../shared/types';
import { generateId, now, toIsoString } from '../../../shared/utils';
import { requireSpaceAccess } from '../shared/route-auth';
import type { AuthenticatedRouteEnv } from '../shared/route-auth';
import { BadRequestError, ConflictError, InternalError, NotFoundError } from '@takos/common/errors';
import { zValidator } from '../zod-validator';
import * as gitStore from '../../../application/services/git-smart';
import { sanitizeRepoName } from './base';
import { getDb } from '../../../infra/db';
import { repositories, accounts } from '../../../infra/db/schema';
import { eq, and, sql } from 'drizzle-orm';
import { logError } from '../../../shared/utils/logger';

type GitObjectsBucket = NonNullable<AuthenticatedRouteEnv['Bindings']['GIT_OBJECTS']>;
type CommitDataBucket = Parameters<typeof gitStore.getCommitData>[0];
type DirectoryBucket = Parameters<typeof gitStore.listDirectory>[0];

export default new Hono<AuthenticatedRouteEnv>()
  .post('/repos/:repoId/fork', zValidator('json', z.object({
    target_space_id: z.string().optional(),
    name: z.string().optional(),
    copy_workflows: z.boolean().optional(),
  })), async (c) => {
  const user = c.get('user');
  const repoId = c.req.param('repoId');
  const body = c.req.valid('json');

  const db = getDb(c.env.DB);

  const sourceRepoData = await db.select().from(repositories).where(eq(repositories.id, repoId)).get();

  if (!sourceRepoData) {
    throw new NotFoundError('Repository');
  }

  if (sourceRepoData.visibility === 'private') {
    const access = await requireSpaceAccess(
      c,
      sourceRepoData.accountId,
      user.id,
      undefined,
      'Repository not found'
    );
  }
  const targetSpaceId = body.target_space_id || null;

  let resolvedTargetSpaceId: string;

  if (targetSpaceId) {
    const targetAccess = await requireSpaceAccess(
      c,
      targetSpaceId,
      user.id,
      ['owner', 'admin', 'editor'],
      'Target workspace not found or insufficient permissions'
    );
    if (targetAccess instanceof Response) return targetAccess;
    resolvedTargetSpaceId = targetAccess.space.id;
  } else {
    // Default to user's own account
    resolvedTargetSpaceId = user.id;
  }

  const forkName = body.name || sourceRepoData.name;
  const sanitizedName = sanitizeRepoName(forkName);

  const existing = await db.select({ id: repositories.id })
    .from(repositories)
    .where(and(
      eq(repositories.accountId, resolvedTargetSpaceId),
      eq(repositories.name, sanitizedName),
    ))
    .get();

  if (existing) {
    throw new ConflictError('Repository with this name already exists in target workspace');
  }

  if (resolvedTargetSpaceId === sourceRepoData.accountId && sanitizedName === sourceRepoData.name) {
    throw new BadRequestError('Cannot fork repository to itself');
  }

  const forkId = generateId();
  const timestamp = now();

  await db.insert(repositories).values({
    id: forkId,
    accountId: resolvedTargetSpaceId,
    name: sanitizedName,
    description: sourceRepoData.description,
    visibility: 'private',
    defaultBranch: sourceRepoData.defaultBranch,
    forkedFromId: sourceRepoData.id,
    stars: 0,
    forks: 0,
    gitEnabled: true,
    createdAt: timestamp,
    updatedAt: timestamp,
  });

  try {
    await gitStore.forkRepository(c.env.DB, sourceRepoData.id, forkId);
  } catch (err) {
    await db.delete(repositories).where(eq(repositories.id, forkId));
    logError('Failed to fork repository', err, { action: 'forkRepository', repoId, forkId });
    throw new InternalError('Failed to fork repository');
  }

  await db.update(repositories)
    .set({ forks: sql`${repositories.forks} + 1` })
    .where(eq(repositories.id, sourceRepoData.id));

  let workflowsCopied = 0;
  if (body.copy_workflows && c.env.GIT_OBJECTS) {
    workflowsCopied = await copyWorkflowsFromSource(
      c.env.DB,
      c.env.GIT_OBJECTS,
      sourceRepoData.id,
      forkId
    );
  }

  const forkedRepoData = await db.select().from(repositories).where(eq(repositories.id, forkId)).get();

  const forkedRepo: Repository | null = forkedRepoData ? {
    id: forkedRepoData.id,
    space_id: forkedRepoData.accountId,
    name: forkedRepoData.name,
    description: forkedRepoData.description,
    visibility: forkedRepoData.visibility as Repository['visibility'],
    default_branch: forkedRepoData.defaultBranch,
    forked_from_id: forkedRepoData.forkedFromId,
    stars: forkedRepoData.stars,
    forks: forkedRepoData.forks,
    git_enabled: forkedRepoData.gitEnabled,
    created_at: toIsoString(forkedRepoData.createdAt),
    updated_at: toIsoString(forkedRepoData.updatedAt),
  } : null;

  const sourceAccount = await db.select({
    name: accounts.name,
    slug: accounts.slug,
  }).from(accounts).where(eq(accounts.id, sourceRepoData.accountId)).get();

  return c.json({
    repository: forkedRepo,
    forked_from: {
      id: sourceRepoData.id,
      name: sourceRepoData.name,
      space_id: sourceRepoData.accountId,
      is_official: false,
      owner_username: sourceAccount?.slug || null,
      owner_name: sourceAccount?.name || null,
    },
    workflows_copied: workflowsCopied,
  }, 201);
  });

async function copyWorkflowsFromSource(
  db: D1Database,
  bucket: GitObjectsBucket,
  sourceRepoId: string,
  targetRepoId: string
): Promise<number> {
  try {
    const sourceDefaultBranch = await gitStore.getDefaultBranch(db, sourceRepoId);
    if (!sourceDefaultBranch) {
      return 0;
    }

    const commit = await gitStore.getCommitData(
      bucket as CommitDataBucket,
      sourceDefaultBranch.commit_sha
    );
    if (!commit) {
      return 0;
    }

    const workflowEntries = await gitStore.listDirectory(
      bucket as DirectoryBucket,
      commit.tree,
      '.takos/workflows'
    );
    if (!workflowEntries) {
      return 0;
    }

    return workflowEntries.filter((entry) => entry.mode !== gitStore.FILE_MODES.DIRECTORY).length;
  } catch (err) {
    logError('Failed to count workflows', err, { action: 'copyWorkflowsFromSource', sourceRepoId, targetRepoId });
    return 0;
  }
}
