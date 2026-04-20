import type { D1Database } from "../../../shared/types/bindings.ts";
import type {
  AuthorType,
  PullRequestStatus,
  User,
} from "../../../shared/types/index.ts";
import * as gitStore from "../git-smart/index.ts";
import { branches, getDb, pullRequests } from "../../../infra/db/index.ts";
import { and, eq } from "drizzle-orm";
import { decodeBlobContent } from "../../../shared/utils/unified-diff.ts";
import { textDate, textDateNullable } from "../../../shared/utils/db-guards.ts";

type GitBucket = Parameters<typeof gitStore.getBlob>[0];

function getCommitData(bucket: GitBucket, sha: string) {
  return gitStore.getCommitData(bucket, sha);
}

function putBlob(bucket: GitBucket, blob: Uint8Array) {
  return gitStore.putBlob(bucket, blob);
}

function mergeTrees3Way(
  bucket: GitBucket,
  baseTree: string,
  localTree: string,
  incomingTree: string,
) {
  return gitStore.mergeTrees3Way(
    bucket,
    baseTree,
    localTree,
    incomingTree,
  );
}

function flattenTree(bucket: GitBucket, treeSha: string) {
  return gitStore.flattenTree(bucket, treeSha);
}

function buildTreeFromPaths(
  bucket: GitBucket,
  files: Array<{ path: string; sha: string; mode?: string }>,
) {
  return gitStore.buildTreeFromPaths(
    bucket,
    files,
  );
}

function createCommit(
  db: D1Database,
  bucket: GitBucket,
  repoId: string,
  params: Parameters<typeof gitStore.createCommit>[3],
) {
  return gitStore.createCommit(
    db,
    bucket,
    repoId,
    params,
  );
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Resolution {
  path: string;
  content: string;
  delete: boolean;
}

export interface MergeResolutionParams {
  db: D1Database;
  bucket: GitBucket;
  repoId: string;
  pullRequestId: string;
  baseBranch: string;
  headBranch: string;
  resolutions: Resolution[];
  commitMessage: string | undefined;
  user: User;
}

export type MergeResolutionSuccess = {
  success: true;
  pullRequest: {
    id: string;
    repoId: string;
    number: number;
    title: string;
    description: string | null;
    headBranch: string;
    baseBranch: string;
    status: PullRequestStatus;
    authorType: AuthorType;
    authorId: string | null;
    mergedAt: string | null;
    createdAt: string;
    updatedAt: string;
  };
  mergeCommit: string;
};

export type MergeResolutionFailure = {
  success: false;
  status: number;
  body: Record<string, unknown>;
};

export type MergeResolutionResult =
  | MergeResolutionSuccess
  | MergeResolutionFailure;

// ---------------------------------------------------------------------------
// Core logic
// ---------------------------------------------------------------------------

/**
 * Resolve merge conflicts for a pull request by applying user-provided resolutions
 * and creating a merge commit.
 */
export async function resolveConflictsAndMerge(
  params: MergeResolutionParams,
): Promise<MergeResolutionResult> {
  const {
    db: dbBinding,
    bucket,
    repoId,
    pullRequestId,
    baseBranch,
    headBranch,
    resolutions,
    user,
  } = params;

  const baseBranchRef = await gitStore.getBranch(dbBinding, repoId, baseBranch);
  const headBranchRef = await gitStore.getBranch(dbBinding, repoId, headBranch);
  if (!baseBranchRef || !headBranchRef) {
    return failure(404, { error: "Branch not found" });
  }

  const baseSha = baseBranchRef.commit_sha;
  const headSha = headBranchRef.commit_sha;

  const mergeBase = await gitStore.findMergeBase(
    dbBinding,
    bucket,
    repoId,
    baseSha,
    headSha,
  );
  if (!mergeBase) {
    return failure(409, { error: "No common ancestor found" });
  }

  const [baseCommit, localCommit, incomingCommit] = await Promise.all([
    getCommitData(bucket, mergeBase),
    getCommitData(bucket, baseSha),
    getCommitData(bucket, headSha),
  ]);

  if (!baseCommit || !localCommit || !incomingCommit) {
    return failure(500, { error: "Failed to load commits" });
  }

  // Apply user resolutions to blobs
  const treeChanges: Array<{ path: string; sha: string | null; mode: string }> =
    [];
  for (const resolution of resolutions) {
    if (resolution.delete) {
      treeChanges.push({ path: resolution.path, sha: null, mode: "100644" });
    } else {
      const blob = new TextEncoder().encode(resolution.content);
      const sha = await putBlob(bucket, blob);
      treeChanges.push({ path: resolution.path, sha, mode: "100644" });
    }
  }

  // Perform three-way merge and gather all file entries
  const mergeResult = await mergeTrees3Way(
    bucket,
    baseCommit.tree,
    localCommit.tree,
    incomingCommit.tree,
  );
  const [baseFiles, localFiles, incomingFiles] = await Promise.all([
    flattenTree(bucket, baseCommit.tree),
    flattenTree(bucket, localCommit.tree),
    flattenTree(bucket, incomingCommit.tree),
  ]);

  const conflictPaths = new Set(mergeResult.conflicts.map((cf) => cf.path));
  const mergedFiles = buildMergedFileMap(
    baseFiles,
    localFiles,
    incomingFiles,
    conflictPaths,
  );

  // Apply user resolution changes
  for (const change of treeChanges) {
    if (change.sha === null) {
      mergedFiles.delete(change.path);
    } else {
      mergedFiles.set(change.path, { sha: change.sha, mode: change.mode });
    }
  }

  // Validate all conflicts are resolved
  const resolutionPaths = new Set(resolutions.map((r) => r.path));
  for (const conflict of mergeResult.conflicts) {
    if (
      !resolutionPaths.has(conflict.path) && !mergedFiles.has(conflict.path)
    ) {
      return failure(400, {
        error: `Conflict not resolved for path: ${conflict.path}`,
      });
    }
  }

  // Build the merged tree and create the commit
  const mergedFileList = Array.from(mergedFiles.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([path, entry]) => ({ path, sha: entry.sha, mode: entry.mode }));

  const treeOid = await buildTreeFromPaths(bucket, mergedFileList);

  const timestamp = new Date().toISOString();
  const signature = buildUserSignature(user, timestamp);
  const message = params.commitMessage ||
    `Merge branch '${headBranch}' into ${baseBranch} (conflicts resolved)`;
  const commit = await createCommit(dbBinding, bucket, repoId, {
    tree: treeOid,
    parents: [baseSha, headSha],
    message,
    author: signature,
    committer: signature,
  });

  // Advance the base branch and mark the PR as merged
  const mergeApply = await advanceBaseBranchAndMarkMerged(dbBinding, {
    repoId,
    baseBranch,
    expectedBaseSha: baseSha,
    newBaseSha: commit.sha,
    pullRequestId,
    timestamp,
  });

  if (!mergeApply.success) {
    return mapMergeApplyFailure(mergeApply);
  }

  return {
    success: true,
    pullRequest: mergeApply.pullRequest,
    mergeCommit: commit.sha,
  };
}

// ---------------------------------------------------------------------------
// Conflict detail fetching (used by the /conflicts endpoint)
// ---------------------------------------------------------------------------

export interface DetailedConflict {
  path: string;
  type: string;
  base: string | null;
  ours: string | null;
  theirs: string | null;
}

export interface ConflictCheckResult {
  conflicts: DetailedConflict[];
  merge_base: string | null;
  is_mergeable: boolean;
  base_sha?: string;
  head_sha?: string;
  message?: string;
}

/**
 * Check for merge conflicts between the base and head branches.
 */
export async function checkConflicts(
  db: D1Database,
  bucket: GitBucket,
  repoId: string,
  baseBranchName: string,
  headBranchName: string,
): Promise<ConflictCheckResult> {
  const baseBranch = await gitStore.getBranch(db, repoId, baseBranchName);
  const headBranch = await gitStore.getBranch(db, repoId, headBranchName);
  if (!baseBranch || !headBranch) {
    throw new ConflictCheckError(404, "Branch not found");
  }

  const mergeBase = await gitStore.findMergeBase(
    db,
    bucket,
    repoId,
    baseBranch.commit_sha,
    headBranch.commit_sha,
  );
  if (!mergeBase) {
    return {
      conflicts: [],
      merge_base: null,
      is_mergeable: false,
      message: "No common ancestor",
    };
  }

  const [baseCommit, localCommit, incomingCommit] = await Promise.all([
    getCommitData(bucket, mergeBase),
    getCommitData(bucket, baseBranch.commit_sha),
    getCommitData(bucket, headBranch.commit_sha),
  ]);

  if (!baseCommit || !localCommit || !incomingCommit) {
    throw new ConflictCheckError(500, "Failed to load commits");
  }

  const mergeResult = await mergeTrees3Way(
    bucket,
    baseCommit.tree,
    localCommit.tree,
    incomingCommit.tree,
  );

  if (mergeResult.conflicts.length === 0) {
    return { conflicts: [], merge_base: mergeBase, is_mergeable: true };
  }

  const detailedConflicts = await Promise.all(
    mergeResult.conflicts.map(async (conflict) => {
      const [baseBlob, oursBlob, theirsBlob] = await Promise.all([
        gitStore.getBlobAtPath(bucket, baseCommit.tree, conflict.path).catch(
          () => null,
        ),
        gitStore.getBlobAtPath(bucket, localCommit.tree, conflict.path).catch(
          () => null,
        ),
        gitStore.getBlobAtPath(bucket, incomingCommit.tree, conflict.path)
          .catch(() => null),
      ]);

      return {
        path: conflict.path,
        type: conflict.type,
        base: decodeBlob(baseBlob),
        ours: decodeBlob(oursBlob),
        theirs: decodeBlob(theirsBlob),
      };
    }),
  );

  return {
    conflicts: detailedConflicts,
    merge_base: mergeBase,
    is_mergeable: false,
    base_sha: baseBranch.commit_sha,
    head_sha: headBranch.commit_sha,
  };
}

export class ConflictCheckError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "ConflictCheckError";
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

type FileEntry = { path: string; sha: string; mode: string };

function buildMergedFileMap(
  baseFiles: FileEntry[],
  localFiles: FileEntry[],
  incomingFiles: FileEntry[],
  conflictPaths: Set<string>,
): Map<string, { sha: string; mode: string }> {
  const baseMap = new Map(baseFiles.map((f) => [f.path, f]));
  const localMap = new Map(localFiles.map((f) => [f.path, f]));
  const incomingMap = new Map(incomingFiles.map((f) => [f.path, f]));
  const allPaths = new Set([
    ...baseMap.keys(),
    ...localMap.keys(),
    ...incomingMap.keys(),
  ]);

  const mergedFilesMap = new Map<string, { sha: string; mode: string }>();

  for (const path of allPaths) {
    if (conflictPaths.has(path)) continue;

    const baseEntry = baseMap.get(path);
    const localEntry = localMap.get(path);
    const incomingEntry = incomingMap.get(path);

    const localChanged = !baseEntry || !localEntry ||
      baseEntry.sha !== localEntry.sha ||
      baseEntry.mode !== localEntry.mode;
    const incomingChanged = !baseEntry || !incomingEntry ||
      baseEntry.sha !== incomingEntry.sha ||
      baseEntry.mode !== incomingEntry.mode;

    if (!localChanged && !incomingChanged) {
      if (baseEntry) {
        mergedFilesMap.set(path, { sha: baseEntry.sha, mode: baseEntry.mode });
      }
    } else if (localChanged && !incomingChanged) {
      if (localEntry) {
        mergedFilesMap.set(path, {
          sha: localEntry.sha,
          mode: localEntry.mode,
        });
      }
    } else if (!localChanged && incomingChanged) {
      if (incomingEntry) {
        mergedFilesMap.set(path, {
          sha: incomingEntry.sha,
          mode: incomingEntry.mode,
        });
      }
    } else if (
      localEntry && incomingEntry && localEntry.sha === incomingEntry.sha
    ) {
      mergedFilesMap.set(path, { sha: localEntry.sha, mode: localEntry.mode });
    }
  }

  return mergedFilesMap;
}

function buildUserSignature(
  user: User,
  _timestamp: string,
): { name: string; email: string; timestamp: number; tzOffset: string } {
  return {
    name: user.name || "User",
    email: user.email || "user@takos.dev",
    timestamp: Math.floor(Date.now() / 1000),
    tzOffset: "+0000",
  };
}

function decodeBlob(blob: Uint8Array | null): string | null {
  if (!blob) return null;
  const { text, isBinary } = decodeBlobContent(blob);
  return isBinary ? null : text;
}

function failure(
  status: number,
  body: Record<string, unknown>,
): MergeResolutionFailure {
  return { success: false, status, body };
}

type MergeApplyFailure = {
  success: false;
  error: "branch_not_found" | "ref_conflict";
  current: string | null;
};
type MergeApplySuccess = {
  success: true;
  pullRequest: MergeResolutionSuccess["pullRequest"];
};
type MergeApplyResult = MergeApplySuccess | MergeApplyFailure;

async function advanceBaseBranchAndMarkMerged(
  dbBinding: D1Database,
  params: {
    repoId: string;
    baseBranch: string;
    expectedBaseSha: string;
    newBaseSha: string;
    pullRequestId: string;
    timestamp: string;
  },
): Promise<MergeApplyResult> {
  const db = getDb(dbBinding);

  const branchUpdate = await db.update(branches)
    .set({
      commitSha: params.newBaseSha,
      updatedAt: params.timestamp,
    })
    .where(and(
      eq(branches.repoId, params.repoId),
      eq(branches.name, params.baseBranch),
      eq(branches.commitSha, params.expectedBaseSha),
    ))
    .returning()
    .all();

  if (branchUpdate.length === 0) {
    const currentBranch = await db.select({ commitSha: branches.commitSha })
      .from(branches)
      .where(and(
        eq(branches.repoId, params.repoId),
        eq(branches.name, params.baseBranch),
      ))
      .get();

    if (!currentBranch) {
      return {
        success: false as const,
        error: "branch_not_found" as const,
        current: null,
      };
    }

    return {
      success: false as const,
      error: "ref_conflict" as const,
      current: currentBranch.commitSha,
    };
  }

  const updatedPullRequest = await db.update(pullRequests)
    .set({
      status: "merged",
      mergedAt: params.timestamp,
      updatedAt: params.timestamp,
    })
    .where(eq(pullRequests.id, params.pullRequestId))
    .returning()
    .get();

  return {
    success: true as const,
    pullRequest: {
      ...updatedPullRequest,
      status: updatedPullRequest.status as PullRequestStatus,
      authorType: updatedPullRequest.authorType as AuthorType,
      createdAt: textDate(updatedPullRequest.createdAt),
      updatedAt: textDate(updatedPullRequest.updatedAt),
      mergedAt: textDateNullable(updatedPullRequest.mergedAt),
    },
  };
}

function mapMergeApplyFailure(
  result: MergeApplyFailure,
): MergeResolutionFailure {
  if (result.error === "branch_not_found") {
    return failure(404, { error: "Branch not found" });
  }
  return failure(409, {
    error: "REF_CONFLICT",
    message: "Ref conflict: branch was modified by another process",
    current: result.current || null,
  });
}
