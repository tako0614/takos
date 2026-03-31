import type { User } from '../../../shared/types/index.ts';

import * as gitStore from '../../../application/services/git-smart/index.ts';
import { type Database } from '../../../infra/db/index.ts';
import { eq, and } from 'drizzle-orm';
import { pullRequests, branches } from '../../../infra/db/schema.ts';
import type { AuthenticatedRouteEnv } from '../route-auth.ts';
import { toPullRequestRecord, type PullRequestRecord } from './dto.ts';
import { toGitBucket, type GitBucket } from '../../../shared/utils/git-bucket.ts';
import { GIT_REBASE_MAX_COMMITS } from '../../../shared/config/limits.ts';

type MergeApplyFailure = { success: false; error: 'branch_not_found' | 'ref_conflict'; current: string | null };
type MergeApplySuccess = { success: true; pullRequest: PullRequestRecord };
type MergeApplyResult = MergeApplySuccess | MergeApplyFailure;
export type MergeMethod = 'merge' | 'squash' | 'rebase';

type MergeExecutionFailure = {
  success: false;
  status: number;
  body: Record<string, unknown>;
};

type MergeExecutionSuccess = {
  success: true;
  pullRequest: PullRequestRecord;
  mergeCommit: string;
  headSha: string;
  baseShaForEvent: string;
  pushBefore: string | null;
};

export type MergeExecutionResult = MergeExecutionSuccess | MergeExecutionFailure;

type MergeTargetSuccess = { success: true; newBaseSha: string };
type MergeTargetResult = MergeTargetSuccess | MergeExecutionFailure;

function buildUserSignature(user: User, timestamp: string): gitStore.GitSignature {
  return {
    name: user.name || 'User',
    email: user.email || 'user@takos.dev',
    timestamp: Math.floor(new Date(timestamp).getTime() / 1000),
    tzOffset: '+0000',
  };
}

function mergeFailure(status: number, body: Record<string, unknown>): MergeExecutionFailure {
  return { success: false, status, body };
}

function mapMergeApplyFailure(result: MergeApplyFailure): MergeExecutionFailure {
  if (result.error === 'branch_not_found') {
    return mergeFailure(404, { error: 'Branch not found' });
  }
  return mergeFailure(409, {
    error: 'REF_CONFLICT',
    message: 'Ref conflict: branch was modified by another process',
    current: result.current || null,
  });
}

export function jsonErrorWithStatus(body: Record<string, unknown>, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export function validateConflictResolutionPath(path: unknown): string | null {
  if (typeof path !== 'string') {
    return null;
  }
  const normalized = path.trim();
  if (!gitStore.isValidGitPath(normalized)) {
    return null;
  }
  return normalized;
}

async function advanceBaseBranchAndMarkPullRequestMerged(
  db: Database,
  params: {
    repoId: string;
    baseBranch: string;
    expectedBaseSha: string;
    newBaseSha: string;
    pullRequestId: string;
    timestamp: string;
  }
): Promise<MergeApplyResult> {
  const branchUpdateResult = await db.update(branches)
    .set({
      commitSha: params.newBaseSha,
      updatedAt: params.timestamp,
    })
    .where(and(
      eq(branches.repoId, params.repoId),
      eq(branches.name, params.baseBranch),
      eq(branches.commitSha, params.expectedBaseSha),
    ))
    .returning();

  if (branchUpdateResult.length === 0) {
    const currentBranch = await db.select({ commitSha: branches.commitSha })
      .from(branches)
      .where(and(
        eq(branches.repoId, params.repoId),
        eq(branches.name, params.baseBranch),
      ))
      .get();

    if (!currentBranch) {
      return { success: false, error: 'branch_not_found', current: null };
    }

    return {
      success: false,
      error: 'ref_conflict',
      current: currentBranch.commitSha,
    };
  }

  const updatedPullRequest = await db.update(pullRequests)
    .set({
      status: 'merged',
      mergedAt: params.timestamp,
      updatedAt: params.timestamp,
    })
    .where(eq(pullRequests.id, params.pullRequestId))
    .returning()
    .get();

  return {
    success: true,
    pullRequest: toPullRequestRecord(updatedPullRequest),
  };
}

async function createRebaseMergeTarget(params: {
  env: AuthenticatedRouteEnv['Bindings'];
  bucket: GitBucket;
  repoId: string;
  baseSha: string;
  headSha: string;
  user: User;
}): Promise<MergeTargetResult> {
  const mergeBase = await gitStore.findMergeBase(
    params.env.DB,
    params.bucket,
    params.repoId,
    params.baseSha,
    params.headSha
  );
  if (!mergeBase) {
    return mergeFailure(409, {
      status: 'conflict',
      conflicts: [],
      merge_base: null,
    });
  }

  const MAX_REBASE_COMMITS = GIT_REBASE_MAX_COMMITS;
  const commitsToRebase: gitStore.GitCommit[] = [];
  let cursorSha = params.headSha;
  while (cursorSha !== mergeBase) {
    const commit = await gitStore.getCommitData(params.bucket, cursorSha);
    if (!commit) {
      return mergeFailure(500, { error: 'Failed to load commits for rebase' });
    }
    if (commit.parents.length !== 1) {
      return mergeFailure(501, { error: 'Rebase merge does not support merge commits yet' });
    }
    commitsToRebase.push(commit);
    cursorSha = commit.parents[0];
    if (commitsToRebase.length > MAX_REBASE_COMMITS) {
      return mergeFailure(413, { error: 'Rebase merge is too large' });
    }
  }

  commitsToRebase.reverse();

  const baseCommit = await gitStore.getCommitData(params.bucket, params.baseSha);
  if (!baseCommit) {
    return mergeFailure(500, { error: 'Failed to load commits for rebase' });
  }

  let currentParentSha = params.baseSha;
  let currentTreeOid = baseCommit.tree;

  for (const original of commitsToRebase) {
    const originalParentSha = original.parents[0];
    const originalParentCommit = await gitStore.getCommitData(params.bucket, originalParentSha);
    if (!originalParentCommit) {
      return mergeFailure(500, { error: 'Failed to load commits for rebase' });
    }

    const mergeResult = await gitStore.mergeTrees3Way(
      params.bucket,
      originalParentCommit.tree,
      currentTreeOid,
      original.tree
    );

    if (!mergeResult.tree_sha || mergeResult.conflicts.length > 0) {
      return mergeFailure(409, {
        status: 'conflict',
        conflicts: mergeResult.conflicts,
        merge_base: mergeBase,
        at_commit_sha: original.sha,
      });
    }

    const timestamp = new Date().toISOString();
    const commit = await gitStore.createCommit(params.env.DB, params.bucket, params.repoId, {
      tree: mergeResult.tree_sha,
      parents: [currentParentSha],
      message: original.message,
      author: original.author,
      committer: buildUserSignature(params.user, timestamp),
    });

    currentParentSha = commit.sha;
    currentTreeOid = mergeResult.tree_sha;
  }

  return { success: true, newBaseSha: currentParentSha };
}

async function createMergeOrSquashTarget(params: {
  env: AuthenticatedRouteEnv['Bindings'];
  bucket: GitBucket;
  repoId: string;
  pullRequest: PullRequestRecord;
  user: User;
  mergeMethod: 'merge' | 'squash';
  commitMessage: string;
  baseSha: string;
  headSha: string;
  canFastForward: boolean;
}): Promise<MergeTargetResult> {
  let treeOid: string;
  if (params.canFastForward) {
    const headCommit = await gitStore.getCommitData(params.bucket, params.headSha);
    if (!headCommit) {
      return mergeFailure(500, { error: 'Failed to load commits for merge' });
    }
    treeOid = headCommit.tree;
  } else {
    const mergeBase = await gitStore.findMergeBase(
      params.env.DB,
      params.bucket,
      params.repoId,
      params.baseSha,
      params.headSha
    );
    if (!mergeBase) {
      return mergeFailure(409, {
        status: 'conflict',
        conflicts: [],
        merge_base: null,
      });
    }

    const [baseCommit, localCommit, incomingCommit] = await Promise.all([
      gitStore.getCommitData(params.bucket, mergeBase),
      gitStore.getCommitData(params.bucket, params.baseSha),
      gitStore.getCommitData(params.bucket, params.headSha),
    ]);

    if (!baseCommit || !localCommit || !incomingCommit) {
      return mergeFailure(500, { error: 'Failed to load commits for merge' });
    }

    const mergeResult = await gitStore.mergeTrees3Way(
      params.bucket,
      baseCommit.tree,
      localCommit.tree,
      incomingCommit.tree
    );
    if (!mergeResult.tree_sha || mergeResult.conflicts.length > 0) {
      return mergeFailure(409, {
        status: 'conflict',
        conflicts: mergeResult.conflicts,
        merge_base: mergeBase,
      });
    }

    treeOid = mergeResult.tree_sha;
  }

  const timestamp = new Date().toISOString();
  const signature = buildUserSignature(params.user, timestamp);
  const message = params.commitMessage || (
    params.mergeMethod === 'squash'
      ? `Squash merge ${params.pullRequest.headBranch} into ${params.pullRequest.baseBranch}`
      : `Merge ${params.pullRequest.headBranch} into ${params.pullRequest.baseBranch}`
  );

  const commit = await gitStore.createCommit(params.env.DB, params.bucket, params.repoId, {
    tree: treeOid,
    parents: params.mergeMethod === 'squash' ? [params.baseSha] : [params.baseSha, params.headSha],
    message,
    author: signature,
    committer: signature,
  });

  return { success: true, newBaseSha: commit.sha };
}

export async function performPullRequestMerge(params: {
  env: AuthenticatedRouteEnv['Bindings'];
  db: Database;
  repoId: string;
  pullRequest: PullRequestRecord;
  mergeMethod: MergeMethod;
  commitMessage: string;
  user: User;
}): Promise<MergeExecutionResult> {
  const bucketBinding = params.env.GIT_OBJECTS;
  if (!bucketBinding) {
    return mergeFailure(500, { error: 'Git storage not configured' });
  }
  const bucket = toGitBucket(bucketBinding);

  const baseBranch = await gitStore.getBranch(params.env.DB, params.repoId, params.pullRequest.baseBranch);
  const headBranch = await gitStore.getBranch(params.env.DB, params.repoId, params.pullRequest.headBranch);
  if (!baseBranch || !headBranch) {
    return mergeFailure(404, { error: 'Branch not found' });
  }

  const baseSha = baseBranch.commit_sha;
  const headSha = headBranch.commit_sha;

  const headIsAncestorOfBase = await gitStore.isAncestor(
    params.env.DB,
    bucket,
    params.repoId,
    headSha,
    baseSha
  );
  if (headIsAncestorOfBase) {
    const timestamp = new Date().toISOString();
    const updatedPullRequest = await params.db.update(pullRequests)
      .set({
        status: 'merged',
        mergedAt: timestamp,
        updatedAt: timestamp,
      })
      .where(eq(pullRequests.id, params.pullRequest.id))
      .returning()
      .get();

    return {
      success: true,
      pullRequest: toPullRequestRecord(updatedPullRequest),
      mergeCommit: baseSha,
      headSha,
      baseShaForEvent: baseSha,
      pushBefore: null,
    };
  }

  const canFastForward = await gitStore.isAncestor(
    params.env.DB,
    bucket,
    params.repoId,
    baseSha,
    headSha
  );

  let mergeTarget: MergeTargetResult;
  if (canFastForward && params.mergeMethod !== 'squash') {
    mergeTarget = { success: true, newBaseSha: headSha };
  } else if (params.mergeMethod === 'rebase') {
    mergeTarget = await createRebaseMergeTarget({
      env: params.env,
      bucket,
      repoId: params.repoId,
      baseSha,
      headSha,
      user: params.user,
    });
  } else {
    mergeTarget = await createMergeOrSquashTarget({
      env: params.env,
      bucket,
      repoId: params.repoId,
      pullRequest: params.pullRequest,
      user: params.user,
      mergeMethod: params.mergeMethod === 'squash' ? 'squash' : 'merge',
      commitMessage: params.commitMessage,
      baseSha,
      headSha,
      canFastForward,
    });
  }

  if (!mergeTarget.success) {
    return mergeTarget;
  }

  const timestamp = new Date().toISOString();
  const mergeApply = await advanceBaseBranchAndMarkPullRequestMerged(params.db, {
    repoId: params.repoId,
    baseBranch: params.pullRequest.baseBranch,
    expectedBaseSha: baseSha,
    newBaseSha: mergeTarget.newBaseSha,
    pullRequestId: params.pullRequest.id,
    timestamp,
  });

  if (!mergeApply.success) {
    return mapMergeApplyFailure(mergeApply);
  }

  return {
    success: true,
    pullRequest: mergeApply.pullRequest,
    mergeCommit: mergeTarget.newBaseSha,
    headSha,
    baseShaForEvent: mergeTarget.newBaseSha,
    pushBefore: baseSha,
  };
}
