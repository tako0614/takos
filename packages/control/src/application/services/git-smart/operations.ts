/**
 * High-level git operations (init, fork, sync, commit).
 */
import type { D1Database, R2Bucket } from '../../../shared/types/bindings.ts';
import type { GitCommit, GitSignature, GitBranch } from './git-objects';
import { createBranch, getBranch, getDefaultBranch, updateBranch } from './core/refs';
import { createCommit, countCommitsBetween } from './core/commit-index';
import { createEmptyTree, applyTreeChanges } from './core/tree-ops';
import { putBlob, getCommitData } from './core/object-store';
import { getDb, branches, tags, repoForks, repoRemotes } from '../../../infra/db';
import { eq } from 'drizzle-orm';
import { generateId, now } from '../../../shared/utils';

function makeSignature(sig?: GitSignature): GitSignature {
  const ts = now();
  return sig || {
    name: 'System',
    email: 'system@takos.dev',
    timestamp: Math.floor(new Date(ts).getTime() / 1000),
    tzOffset: '+0000',
  };
}

export async function initRepository(
  dbBinding: D1Database,
  bucket: R2Bucket,
  repoId: string,
  defaultBranch = 'main',
  author?: GitSignature,
): Promise<{ commit: GitCommit; branch: GitBranch }> {
  const emptyTreeSha = await createEmptyTree(bucket);
  const signature = makeSignature(author);

  const commit = await createCommit(dbBinding, bucket, repoId, {
    tree: emptyTreeSha,
    parents: [],
    message: 'Initial commit',
    author: signature,
    committer: signature,
  });

  await createBranch(dbBinding, repoId, defaultBranch, commit.sha, true);
  const branch = await getBranch(dbBinding, repoId, defaultBranch);
  if (!branch) throw new Error('Failed to create default branch');

  return { commit, branch };
}

export async function forkRepository(
  dbBinding: D1Database,
  sourceRepoId: string,
  targetRepoId: string,
): Promise<void> {
  const db = getDb(dbBinding);
  const timestamp = now();

  const sourceBranches = await db.select().from(branches).where(eq(branches.repoId, sourceRepoId)).all();
  const sourceTags = await db.select().from(tags).where(eq(tags.repoId, sourceRepoId)).all();

  if (sourceBranches.length > 0) {
    await db.insert(branches).values(
      sourceBranches.map((branch) => ({
        id: generateId(), repoId: targetRepoId, name: branch.name, commitSha: branch.commitSha,
        isDefault: branch.isDefault, isProtected: false, createdAt: timestamp, updatedAt: timestamp,
      })),
    );
  }

  if (sourceTags.length > 0) {
    await db.insert(tags).values(
      sourceTags.map((tag) => ({
        id: generateId(), repoId: targetRepoId, name: tag.name, commitSha: tag.commitSha,
        message: tag.message, taggerName: tag.taggerName, taggerEmail: tag.taggerEmail, createdAt: tag.createdAt,
      })),
    );
  }

  await db.insert(repoForks).values({
    id: generateId(), forkRepoId: targetRepoId, upstreamRepoId: sourceRepoId, createdAt: timestamp,
  });
  await db.insert(repoRemotes).values({
    id: generateId(), repoId: targetRepoId, name: 'upstream', upstreamRepoId: sourceRepoId, createdAt: timestamp,
  });
}

export async function checkSyncStatus(
  dbBinding: D1Database, bucket: R2Bucket, forkRepoId: string, branchName?: string,
): Promise<{
  can_sync: boolean; can_fast_forward: boolean;
  commits_behind: number; commits_ahead: number;
  has_merge_base: boolean; has_conflict: boolean;
  upstream_repo_id: string | null;
}> {
  const db = getDb(dbBinding);
  const fork = await db.select().from(repoForks).where(eq(repoForks.forkRepoId, forkRepoId)).get();

  if (!fork) {
    return { can_sync: false, can_fast_forward: false, commits_behind: 0, commits_ahead: 0, has_merge_base: true, has_conflict: false, upstream_repo_id: null };
  }

  const defaultBranchName = branchName || (await getDefaultBranch(dbBinding, forkRepoId))?.name || 'main';
  const forkBranch = await getBranch(dbBinding, forkRepoId, defaultBranchName);
  const upstreamBranch = await getBranch(dbBinding, fork.upstreamRepoId, defaultBranchName);

  if (!forkBranch || !upstreamBranch) {
    return { can_sync: false, can_fast_forward: false, commits_behind: 0, commits_ahead: 0, has_merge_base: true, has_conflict: false, upstream_repo_id: fork.upstreamRepoId };
  }

  const { ahead, behind, has_merge_base } = await countCommitsBetween(dbBinding, bucket, forkRepoId, upstreamBranch.commit_sha, forkBranch.commit_sha);

  if (!has_merge_base) {
    return { can_sync: false, can_fast_forward: false, commits_behind: 0, commits_ahead: 0, has_merge_base: false, has_conflict: true, upstream_repo_id: fork.upstreamRepoId };
  }

  return {
    can_sync: behind > 0, can_fast_forward: ahead === 0 && behind > 0,
    commits_behind: behind, commits_ahead: ahead,
    has_merge_base: true, has_conflict: ahead > 0 && behind > 0,
    upstream_repo_id: fork.upstreamRepoId,
  };
}

export async function commitFile(
  dbBinding: D1Database, bucket: R2Bucket, repoId: string, path: string, content: string, message: string,
  options: { branch?: string; author?: GitSignature } = {},
): Promise<GitCommit> {
  const branchName = options.branch || 'main';
  const branch = await getBranch(dbBinding, repoId, branchName);
  if (!branch) throw new Error(`Branch '${branchName}' not found`);

  const currentCommit = await getCommitData(bucket, branch.commit_sha);
  if (!currentCommit) throw new Error('Current commit not found');

  const contentBytes = new TextEncoder().encode(content);
  const blobSha = await putBlob(bucket, contentBytes);

  const newTreeSha = await applyTreeChanges(bucket, currentCommit.tree, [
    { path, operation: 'add', sha: blobSha },
  ]);

  const author = makeSignature(options.author);
  const commit = await createCommit(dbBinding, bucket, repoId, {
    tree: newTreeSha,
    parents: [branch.commit_sha],
    message,
    author,
    committer: author,
  });

  const updateResult = await updateBranch(dbBinding, repoId, branchName, branch.commit_sha, commit.sha);
  if (!updateResult.success) throw new Error('Failed to update branch');

  return commit;
}
