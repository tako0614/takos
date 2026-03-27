import type { Context } from 'hono';
import type { AuthenticatedRouteEnv } from '../shared/route-auth';
import { getTreeFlattenLimitError, type RepoBucketBinding } from './base';
import { InternalError, PayloadTooLargeError } from '@takos/common/errors';
import type * as gitStore from '../../../application/services/git-smart';
import { logWarn } from '../../../shared/utils/logger';

export type RepoContext = Context<AuthenticatedRouteEnv>;

export const WRITE_ROLES = ['owner', 'admin', 'editor'] as const;

export function requireBucket(c: RepoContext): RepoBucketBinding {
  const bucket = c.env.GIT_OBJECTS;
  if (!bucket) {
    throw new InternalError('Git storage not configured');
  }
  return bucket;
}

export function sigTimestampToIso(timestamp: number | string | undefined): string {
  if (typeof timestamp === 'number') {
    const millis = timestamp > 1_000_000_000_000 ? timestamp : timestamp * 1000;
    return new Date(millis).toISOString();
  }
  if (typeof timestamp === 'string') {
    return new Date(timestamp).toISOString();
  }
  return new Date(0).toISOString();
}

export function getCommitSha(commit: { sha?: string; oid?: string }): string {
  return commit.sha ?? commit.oid ?? '';
}

export function getCommitParents(commit: { parents?: string[] }): string[] {
  return Array.isArray(commit.parents) ? commit.parents : [];
}

export function warnDegradedCommit(
  resolvedCommit: Extract<gitStore.ResolveReadableCommitResult, { ok: true }>,
  repoId: string,
  ref: string
): void {
  if (resolvedCommit.degraded) {
    logWarn(`Falling back to readable commit ${resolvedCommit.resolvedCommitSha} for repo ${repoId} ref ${ref} (requested ${resolvedCommit.refCommitSha})`, { module: 'git-readable-commit' });
  }
}

export function throwIfTreeFlattenLimit(err: unknown, operation: string): void {
  const limitError = getTreeFlattenLimitError(err);
  if (limitError) {
    throw new PayloadTooLargeError(`Repository tree is too large to ${operation}`, {
      code: limitError.code,
      detail: limitError.detail,
    });
  }
}
