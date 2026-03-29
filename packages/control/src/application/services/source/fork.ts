import type { D1Database, R2Bucket } from '../../../shared/types/bindings.ts';
import type { Repository } from '../../../shared/types';
import { generateId, sanitizeRepoName } from '../../../shared/utils';
import * as gitStore from '../git-smart';
import { toApiRepositoryFromDb } from './repos';
import { getDb, repositories, repoReleases } from '../../../infra/db';
import { eq, and, desc } from 'drizzle-orm';
import { sql } from 'drizzle-orm';
import { logError } from '../../../shared/utils/logger';

export interface ForkOptions {
  name?: string;
  copyWorkflows?: boolean;
  copyConfig?: boolean;
}

export interface ForkResult {
  repository: Repository;
  forked_from: {
    id: string;
    name: string;
    space_id: string;
    is_official: boolean;
  };
  workflows_copied?: number;
}

export interface SyncStatus {
  can_sync: boolean;
  can_fast_forward: boolean;
  commits_behind: number;
  commits_ahead: number;
  has_conflicts: boolean;
  upstream: {
    id: string;
    name: string;
    space_id: string;
    default_branch: string;
  } | null;
  upstream_releases: UpstreamRelease[];
}

export interface UpstreamRelease {
  id: string;
  tag: string;
  name: string | null;
  published_at: string | null;
  is_newer: boolean;
}

export interface SyncOptions {
  strategy: 'merge' | 'rebase';
  target_ref?: string;
}

export interface SyncResult {
  success: boolean;
  commits_synced: number;
  new_head?: string;
  conflict?: boolean;
  message: string;
}

/**
 * Fork a repository with extended options
 * - Copies workflows if specified
 * - Generates .takos/config.yml template
 */
export async function forkWithWorkflows(
  db: D1Database,
  bucket: R2Bucket | undefined,
  sourceRepoId: string,
  targetWorkspaceId: string,
  options: ForkOptions = {}
): Promise<ForkResult> {
  const drizzle = getDb(db);

  const sourceRepo = await drizzle.select().from(repositories).where(eq(repositories.id, sourceRepoId)).get();

  if (!sourceRepo) {
    throw new Error('Source repository not found');
  }

  const forkName = sanitizeRepoName(options.name || sourceRepo.name);

  const existing = await drizzle.select({ id: repositories.id }).from(repositories).where(and(eq(repositories.accountId, targetWorkspaceId), eq(repositories.name, forkName))).get();

  if (existing) {
    throw new Error('Repository with this name already exists in target workspace');
  }

  const forkId = generateId();
  const timestamp = new Date().toISOString();

  await drizzle.insert(repositories).values({
    id: forkId,
    accountId: targetWorkspaceId,
    name: forkName,
    description: sourceRepo.description,
    visibility: 'private',
    defaultBranch: sourceRepo.defaultBranch,
    forkedFromId: sourceRepo.id,
    stars: 0,
    forks: 0,
    gitEnabled: true,
    createdAt: timestamp,
    updatedAt: timestamp,
  });

  await gitStore.forkRepository(db, sourceRepo.id, forkId);

  await drizzle.update(repositories).set({ forks: sql`${repositories.forks} + 1` }).where(eq(repositories.id, sourceRepo.id));

  let workflowsCopied = 0;

  if (options.copyWorkflows && bucket) {
    workflowsCopied = await copyWorkflows(db, bucket, sourceRepoId, forkId);
  }

  const forkedRepo = await drizzle.select().from(repositories).where(eq(repositories.id, forkId)).get();

  if (!forkedRepo) {
    throw new Error('Failed to retrieve forked repository');
  }

  return {
    repository: toApiRepositoryFromDb(forkedRepo),
    forked_from: {
      id: sourceRepo.id,
      name: sourceRepo.name,
      space_id: sourceRepo.accountId,
      is_official: false,
    },
    workflows_copied: workflowsCopied,
  };
}

/**
 * Get sync status between a fork and its upstream
 */
export async function getSyncStatus(
  db: D1Database,
  bucket: R2Bucket | undefined,
  repoId: string
): Promise<SyncStatus> {
  const drizzle = getDb(db);

  const repo = await drizzle.select().from(repositories).where(eq(repositories.id, repoId)).get();

  if (!repo) {
    throw new Error('Repository not found');
  }

  const noSyncResult: SyncStatus = {
    can_sync: false,
    can_fast_forward: false,
    commits_behind: 0,
    commits_ahead: 0,
    has_conflicts: false,
    upstream: null,
    upstream_releases: [],
  };

  if (!repo.forkedFromId) {
    return noSyncResult;
  }

  const upstream = await drizzle.select().from(repositories).where(eq(repositories.id, repo.forkedFromId)).get();

  if (!upstream) {
    return noSyncResult;
  }

  let syncStatus = {
    can_sync: false,
    can_fast_forward: false,
    commits_behind: 0,
    commits_ahead: 0,
    has_conflict: false,
  };

  if (bucket) {
    const branchName = repo.defaultBranch || 'main';
    syncStatus = await gitStore.checkSyncStatus(db, bucket, repoId, branchName);
  }

  const upstreamReleases = await getUpstreamReleases(db, upstream.id, repoId);

  return {
    can_sync: syncStatus.can_sync,
    can_fast_forward: syncStatus.can_fast_forward,
    commits_behind: syncStatus.commits_behind,
    commits_ahead: syncStatus.commits_ahead,
    has_conflicts: syncStatus.has_conflict,
    upstream: {
      id: upstream.id,
      name: upstream.name,
      space_id: upstream.accountId,
      default_branch: upstream.defaultBranch,
    },
    upstream_releases: upstreamReleases,
  };
}

/**
 * Sync a fork with its upstream repository
 */
export async function syncWithUpstream(
  db: D1Database,
  bucket: R2Bucket | undefined,
  repoId: string,
  options: SyncOptions = { strategy: 'merge' }
): Promise<SyncResult> {
  const drizzle = getDb(db);

  const repo = await drizzle.select().from(repositories).where(eq(repositories.id, repoId)).get();

  if (!repo) {
    throw new Error('Repository not found');
  }

  if (!repo.forkedFromId) {
    throw new Error('Repository is not a fork');
  }

  const upstream = await drizzle.select().from(repositories).where(eq(repositories.id, repo.forkedFromId)).get();

  if (!upstream) {
    throw new Error('Upstream repository not found');
  }

  if (!bucket) {
    throw new Error('Git storage not configured');
  }

  const branchName = options.target_ref || repo.defaultBranch || 'main';

  const status = await gitStore.checkSyncStatus(db, bucket, repoId, branchName);

  if (status.has_conflict) {
    return {
      success: false,
      commits_synced: 0,
      conflict: true,
      message: 'Cannot fast-forward. Fork has diverged from upstream. Manual merge required.',
    };
  }

  if (!status.can_sync) {
    return {
      success: true,
      commits_synced: 0,
      message: 'Already up to date',
    };
  }

  const upstreamBranch = await gitStore.getBranch(db, upstream.id, branchName);
  if (!upstreamBranch) {
    throw new Error('Upstream branch not found');
  }

  const forkBranch = await gitStore.getBranch(db, repoId, branchName);
  const oldSha = forkBranch?.commit_sha || null;

  const updateResult = await gitStore.updateBranch(
    db,
    repoId,
    branchName,
    oldSha,
    upstreamBranch.commit_sha
  );

  if (!updateResult.success) {
    return {
      success: false,
      commits_synced: 0,
      message: 'Failed to update branch',
    };
  }

  return {
    success: true,
    commits_synced: status.commits_behind,
    new_head: upstreamBranch.commit_sha,
    message: `Synced ${status.commits_behind} commit(s) from upstream`,
  };
}

/**
 * Copy workflows from source repo to target repo
 */
async function copyWorkflows(
  db: D1Database,
  bucket: R2Bucket,
  sourceRepoId: string,
  targetRepoId: string
): Promise<number> {
  const sourceDefaultBranch = await gitStore.getDefaultBranch(db, sourceRepoId);
  if (!sourceDefaultBranch) {
    return 0;
  }

  try {
    const commit = await gitStore.getCommitData(bucket, sourceDefaultBranch.commit_sha);
    if (!commit) {
      return 0;
    }

    const workflowEntries = await gitStore.listDirectory(bucket, commit.tree, '.takos/workflows');
    if (!workflowEntries) {
      return 0;
    }

    return workflowEntries.filter((entry) => entry.mode !== '040000').length;
  } catch (err) {
    logError('Failed to copy workflows', err, { module: 'services/source/fork' });
    return 0;
  }
}

/**
 * Get releases from upstream that are newer than fork's last sync
 */
async function getUpstreamReleases(
  db: D1Database,
  upstreamId: string,
  forkId: string
): Promise<UpstreamRelease[]> {
  const drizzle = getDb(db);

  const fork = await drizzle.select({ createdAt: repositories.createdAt }).from(repositories).where(eq(repositories.id, forkId)).get();

  const forkCreatedAt = fork?.createdAt || '1970-01-01T00:00:00Z';

  const releases = await drizzle.select({
    id: repoReleases.id,
    tag: repoReleases.tag,
    name: repoReleases.name,
    publishedAt: repoReleases.publishedAt,
  }).from(repoReleases).where(and(eq(repoReleases.repoId, upstreamId), eq(repoReleases.isDraft, false))).orderBy(desc(repoReleases.publishedAt)).limit(5).all();

  return releases.map(r => ({
    id: r.id,
    tag: r.tag,
    name: r.name,
    published_at: (r.publishedAt == null ? null : typeof r.publishedAt === 'string' ? r.publishedAt : r.publishedAt.toISOString()),
    is_newer: r.publishedAt ? r.publishedAt > forkCreatedAt : false,
  }));
}
