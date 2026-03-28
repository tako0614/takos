/**
 * Shared repo utilities used across git, git-advanced, sync, and other repo route files.
 */
import type { Context } from 'hono';
import { NotFoundError } from 'takos-common/errors';
import type { ResolveReadableCommitResult } from '../../../application/services/git-smart';

// ---------------------------------------------------------------------------
// Bucket types and helpers — canonical definitions live in shared/utils/git-bucket.
// Re-exported here for backward-compatible imports within the repos route tree.
// ---------------------------------------------------------------------------

export type { RepoBucketBinding, GitBucket } from '../../../shared/utils/git-bucket';
export { toGitBucket } from '../../../shared/utils/git-bucket';

// ---------------------------------------------------------------------------
// Re-exports
// ---------------------------------------------------------------------------

export { sanitizeRepoName } from '../../../shared/utils';

// ---------------------------------------------------------------------------
// Error / response helpers
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Encoding / role helpers
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Tree flatten limit detection
// ---------------------------------------------------------------------------

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
