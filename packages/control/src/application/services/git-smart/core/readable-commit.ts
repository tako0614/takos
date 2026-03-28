/**
 * Degradation-tolerant commit resolution.
 *
 * Adapted from git-store/readable-commit.ts.
 */

import type { D1Database, R2Bucket } from '../../../../shared/types/bindings.ts';
import type { GitCommit } from '../git-objects';
import { resolveRef } from './refs';
import { getCommit, getCommitLog } from './commit-index';
import { getTree } from './tree-ops';

export type ResolveReadableCommitFailureReason = 'ref_not_found' | 'commit_not_found' | 'tree_not_found';

export type ResolveReadableCommitResult =
  | {
      ok: true;
      refCommitSha: string;
      resolvedCommitSha: string;
      degraded: boolean;
      commit: GitCommit;
    }
  | {
      ok: false;
      reason: ResolveReadableCommitFailureReason;
      refCommitSha?: string;
    };

export async function resolveReadableCommitFromRef(
  db: D1Database,
  bucket: R2Bucket,
  repoId: string,
  ref: string,
  options?: { fallbackLimit?: number },
): Promise<ResolveReadableCommitResult> {
  const refCommitSha = await resolveRef(db, repoId, ref);
  if (!refCommitSha) return { ok: false, reason: 'ref_not_found' };

  const primary = await getCommit(db, bucket, repoId, refCommitSha);
  if (primary) {
    const primaryTree = await getTree(bucket, primary.tree);
    if (primaryTree) {
      return { ok: true, refCommitSha, resolvedCommitSha: primary.sha, degraded: false, commit: primary };
    }
  }

  const fallbackLimit = Math.max(1, options?.fallbackLimit ?? 50);
  const history = await getCommitLog(db, bucket, repoId, refCommitSha, fallbackLimit);

  for (const candidate of history) {
    if (candidate.sha === primary?.sha) continue;
    const tree = await getTree(bucket, candidate.tree);
    if (!tree) continue;
    return { ok: true, refCommitSha, resolvedCommitSha: candidate.sha, degraded: true, commit: candidate };
  }

  if (!primary) return { ok: false, reason: 'commit_not_found', refCommitSha };
  return { ok: false, reason: 'tree_not_found', refCommitSha };
}
