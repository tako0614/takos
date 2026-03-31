/**
 * Commit creation, D1 indexing, and DAG traversal.
 *
 * Adapted from git-store/commit.ts with native git object format.
 */

import type { D1Database, R2Bucket } from '../../../../shared/types/bindings.ts';
import type { GitCommit, GitSignature, CreateCommitParams } from '../git-objects.ts';
import { isValidSha } from '../git-objects.ts';
import { putCommit, getCommitData } from './object-store.ts';
import { getDb, commits } from '../../../../infra/db/index.ts';
import { eq, and } from 'drizzle-orm';
import { generateId } from '../../../../shared/utils/index.ts';
import { textDateNullable } from '../../../../shared/utils/db-guards.ts';

interface CommitIndexRow {
  sha: string;
  treeSha: string;
  parentShas: string | null;
  message: string;
  authorName: string;
  authorEmail: string;
  authorDate: string | Date;
  committerName: string;
  committerEmail: string;
  commitDate: string | Date;
}

function indexedToCommit(row: CommitIndexRow): GitCommit {
  return {
    sha: row.sha,
    tree: row.treeSha,
    parents: row.parentShas ? (() => { try { return JSON.parse(row.parentShas!) as string[]; } catch { return []; } })() : [],
    message: row.message,
    author: {
      name: row.authorName,
      email: row.authorEmail,
      timestamp: Math.floor(new Date(row.authorDate).getTime() / 1000),
      tzOffset: '+0000',
    },
    committer: {
      name: row.committerName,
      email: row.committerEmail,
      timestamp: Math.floor(new Date(row.commitDate).getTime() / 1000),
      tzOffset: '+0000',
    },
  };
}

function makeSignature(sig?: GitSignature): GitSignature {
  const ts = new Date().toISOString();
  return sig || {
    name: 'System',
    email: 'system@takos.dev',
    timestamp: Math.floor(new Date(ts).getTime() / 1000),
    tzOffset: '+0000',
  };
}

function sigTimestampToIso(sig: GitSignature): string {
  return new Date(sig.timestamp * 1000).toISOString();
}

export async function createCommit(
  dbBinding: D1Database,
  bucket: R2Bucket,
  repoId: string,
  params: CreateCommitParams,
): Promise<GitCommit> {
  const author = makeSignature(params.author);
  const committer = makeSignature(params.committer);

  const sha = await putCommit(bucket, {
    tree: params.tree,
    parents: params.parents,
    author,
    committer,
    message: params.message,
  });

  const db = getDb(dbBinding);
  const id = generateId();
  await db.insert(commits).values({
    id,
    repoId,
    sha,
    treeSha: params.tree,
    parentShas: params.parents.length > 0 ? JSON.stringify(params.parents) : null,
    authorName: author.name,
    authorEmail: author.email,
    authorDate: sigTimestampToIso(author),
    committerName: committer.name,
    committerEmail: committer.email,
    commitDate: sigTimestampToIso(committer),
    message: params.message,
  });

  return {
    sha,
    tree: params.tree,
    parents: params.parents,
    message: params.message,
    author,
    committer,
  };
}

/**
 * Index an existing commit (received via push) into D1.
 */
export async function indexCommit(
  dbBinding: D1Database,
  repoId: string,
  commit: GitCommit,
): Promise<void> {
  const db = getDb(dbBinding);

  const existing = await db.select({ id: commits.id }).from(commits)
    .where(and(eq(commits.repoId, repoId), eq(commits.sha, commit.sha)))
    .get();
  if (existing) return;

  const id = generateId();
  await db.insert(commits).values({
    id,
    repoId,
    sha: commit.sha,
    treeSha: commit.tree,
    parentShas: commit.parents.length > 0 ? JSON.stringify(commit.parents) : null,
    authorName: commit.author.name,
    authorEmail: commit.author.email,
    authorDate: sigTimestampToIso(commit.author),
    committerName: commit.committer.name,
    committerEmail: commit.committer.email,
    commitDate: sigTimestampToIso(commit.committer),
    message: commit.message,
  });
}

export async function getCommitFromIndex(
  dbBinding: D1Database, repoId: string, sha: string,
): Promise<GitCommit | null> {
  const db = getDb(dbBinding);
  const indexed = await db.select().from(commits)
    .where(and(eq(commits.repoId, repoId), eq(commits.sha, sha)))
    .get();
  if (!indexed) return null;
  return indexedToCommit({
    sha: indexed.sha,
    treeSha: indexed.treeSha,
    parentShas: indexed.parentShas,
    message: indexed.message,
    authorName: indexed.authorName,
    authorEmail: indexed.authorEmail,
    authorDate: textDateNullable(indexed.authorDate) ?? new Date(0).toISOString(),
    committerName: indexed.committerName,
    committerEmail: indexed.committerEmail,
    commitDate: textDateNullable(indexed.commitDate) ?? new Date(0).toISOString(),
  });
}

export async function getCommit(
  dbBinding: D1Database, bucket: R2Bucket, repoId: string, sha: string,
): Promise<GitCommit | null> {
  const indexed = await getCommitFromIndex(dbBinding, repoId, sha);
  if (indexed) return indexed;
  if (!isValidSha(sha)) return null;
  return getCommitData(bucket, sha);
}

export async function getCommitLog(
  dbBinding: D1Database, bucket: R2Bucket, repoId: string, startSha: string, limit = 50,
): Promise<GitCommit[]> {
  if (!startSha || limit <= 0) return [];

  const commitList: GitCommit[] = [];
  const visited = new Set<string>();
  let cursorSha: string | null = startSha;

  while (cursorSha && commitList.length < limit) {
    if (visited.has(cursorSha)) break;
    visited.add(cursorSha);

    const commit = await getCommit(dbBinding, bucket, repoId, cursorSha);
    if (!commit) break;

    commitList.push(commit);
    cursorSha = commit.parents[0] || null;
  }

  return commitList;
}

export async function getCommitsFromRef(
  dbBinding: D1Database, bucket: R2Bucket, repoId: string, startSha: string, limit = 50,
): Promise<GitCommit[]> {
  const visited = new Set<string>();
  const commitList: GitCommit[] = [];
  const queue: string[] = [startSha];

  while (queue.length > 0 && commitList.length < limit) {
    const sha = queue.shift()!;
    if (visited.has(sha)) continue;
    visited.add(sha);

    const commit = await getCommit(dbBinding, bucket, repoId, sha);
    if (!commit) continue;

    commitList.push(commit);
    for (const parentSha of commit.parents) {
      if (!visited.has(parentSha)) queue.push(parentSha);
    }
  }

  commitList.sort((a, b) => b.committer.timestamp - a.committer.timestamp);
  return commitList.slice(0, limit);
}

export async function isAncestor(
  dbBinding: D1Database, bucket: R2Bucket, repoId: string, ancestorSha: string, descendantSha: string,
): Promise<boolean> {
  if (ancestorSha === descendantSha) return true;

  const visited = new Set<string>();
  const queue: string[] = [descendantSha];

  while (queue.length > 0) {
    const sha = queue.shift()!;
    if (visited.has(sha)) continue;
    visited.add(sha);
    if (sha === ancestorSha) return true;

    const commit = await getCommit(dbBinding, bucket, repoId, sha);
    if (!commit) continue;
    for (const parentSha of commit.parents) {
      if (!visited.has(parentSha)) queue.push(parentSha);
    }
  }

  return false;
}

export async function findMergeBase(
  dbBinding: D1Database, bucket: R2Bucket, repoId: string, sha1: string, sha2: string,
): Promise<string | null> {
  const ancestors1 = new Set<string>();
  const queue1: string[] = [sha1];

  while (queue1.length > 0) {
    const sha = queue1.shift()!;
    if (ancestors1.has(sha)) continue;
    ancestors1.add(sha);
    const commit = await getCommit(dbBinding, bucket, repoId, sha);
    if (commit) {
      for (const parent of commit.parents) queue1.push(parent);
    }
  }

  const queue2: string[] = [sha2];
  const visited2 = new Set<string>();

  while (queue2.length > 0) {
    const sha = queue2.shift()!;
    if (visited2.has(sha)) continue;
    visited2.add(sha);
    if (ancestors1.has(sha)) return sha;
    const commit = await getCommit(dbBinding, bucket, repoId, sha);
    if (commit) {
      for (const parent of commit.parents) queue2.push(parent);
    }
  }

  return null;
}

export async function countCommitsBetween(
  dbBinding: D1Database, bucket: R2Bucket, repoId: string, baseSha: string, headSha: string,
): Promise<{ ahead: number; behind: number; has_merge_base: boolean }> {
  const mergeBase = await findMergeBase(dbBinding, bucket, repoId, baseSha, headSha);
  if (!mergeBase) return { ahead: 0, behind: 0, has_merge_base: false };

  const ahead = await countCommitsTo(dbBinding, bucket, repoId, headSha, mergeBase);
  const behind = await countCommitsTo(dbBinding, bucket, repoId, baseSha, mergeBase);
  return { ahead, behind, has_merge_base: true };
}

async function countCommitsTo(
  dbBinding: D1Database, bucket: R2Bucket, repoId: string, fromSha: string, stopAtSha: string,
): Promise<number> {
  let commitCount = 0;
  const visited = new Set<string>();
  const queue: string[] = [fromSha];

  while (queue.length > 0) {
    const sha = queue.shift()!;
    if (visited.has(sha) || sha === stopAtSha) continue;
    visited.add(sha);
    commitCount++;

    const commit = await getCommit(dbBinding, bucket, repoId, sha);
    if (commit) {
      for (const parent of commit.parents) queue.push(parent);
    }
  }

  return commitCount;
}

/**
 * Collect all object SHAs reachable from want set, stopping at have set.
 * Used for upload-pack negotiation.
 */
export async function collectReachableObjects(
  dbBinding: D1Database,
  bucket: R2Bucket,
  repoId: string,
  wants: string[],
  haves: Set<string>,
): Promise<string[]> {
  const result: string[] = [];
  const visited = new Set<string>();
  const commitQueue: string[] = [...wants];

  while (commitQueue.length > 0) {
    const sha = commitQueue.shift()!;
    if (visited.has(sha) || haves.has(sha)) continue;
    visited.add(sha);
    result.push(sha);

    const commit = await getCommit(dbBinding, bucket, repoId, sha);
    if (!commit) continue;

    // Add tree and walk it
    if (!visited.has(commit.tree) && !haves.has(commit.tree)) {
      await collectTreeObjects(bucket, commit.tree, result, visited, haves);
    }

    for (const parent of commit.parents) {
      if (!visited.has(parent) && !haves.has(parent)) {
        commitQueue.push(parent);
      }
    }
  }

  return result;
}

async function collectTreeObjects(
  bucket: R2Bucket,
  treeSha: string,
  result: string[],
  visited: Set<string>,
  haves: Set<string>,
): Promise<void> {
  if (visited.has(treeSha) || haves.has(treeSha)) return;
  visited.add(treeSha);
  result.push(treeSha);

  const { getTreeEntries } = await import('./object-store.ts');
  const entries = await getTreeEntries(bucket, treeSha);
  if (!entries) return;

  for (const entry of entries) {
    if (visited.has(entry.sha) || haves.has(entry.sha)) continue;

    if (entry.mode === '040000' || entry.mode === '40000') {
      await collectTreeObjects(bucket, entry.sha, result, visited, haves);
    } else {
      visited.add(entry.sha);
      result.push(entry.sha);
    }
  }
}

/**
 * Collect all object SHAs reachable from all refs in a repository.
 * Used for GC / cleanup (determining which objects are still live).
 */
export async function collectReachableObjectShas(
  dbBinding: D1Database,
  bucket: R2Bucket,
  repoId: string,
): Promise<Set<string>> {
  const { listAllRefs } = await import('./refs.ts');
  const { getTreeEntries } = await import('./object-store.ts');

  const refs = await listAllRefs(dbBinding, repoId);

  const reachable = new Set<string>();
  const visitedCommits = new Set<string>();
  const visitedTrees = new Set<string>();
  const commitQueue: string[] = [];

  for (const ref of refs) {
    if (!reachable.has(ref.target)) {
      reachable.add(ref.target);
      commitQueue.push(ref.target);
    }
  }

  while (commitQueue.length > 0) {
    const commitSha = commitQueue.shift();
    if (!commitSha || visitedCommits.has(commitSha)) continue;
    visitedCommits.add(commitSha);

    const commit = await getCommit(dbBinding, bucket, repoId, commitSha);
    if (!commit) continue;

    reachable.add(commit.tree);

    for (const parentSha of commit.parents) {
      reachable.add(parentSha);
      if (!visitedCommits.has(parentSha)) {
        commitQueue.push(parentSha);
      }
    }

    const treeQueue: string[] = [commit.tree];
    while (treeQueue.length > 0) {
      const treeSha = treeQueue.shift();
      if (!treeSha || visitedTrees.has(treeSha)) continue;
      visitedTrees.add(treeSha);

      const entries = await getTreeEntries(bucket, treeSha);
      if (!entries) continue;

      for (const entry of entries) {
        reachable.add(entry.sha);
        if ((entry.mode === '040000' || entry.mode === '40000') && !visitedTrees.has(entry.sha)) {
          treeQueue.push(entry.sha);
        }
      }
    }
  }

  return reachable;
}
