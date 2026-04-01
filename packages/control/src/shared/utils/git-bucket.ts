/**
 * Shared Git bucket type aliases and conversion helpers.
 *
 * These are used by both server routes and application services,
 * so they live in the shared layer to avoid cross-boundary imports.
 */
import type { Env } from '../types/index.ts';
import type * as gitStore from '../../application/services/git-smart/index.ts';

/** The concrete R2-like binding type used by Env.GIT_OBJECTS. */
export type RepoBucketBinding = NonNullable<Env['GIT_OBJECTS']>;

/**
 * The bucket type expected by git-smart storage functions
 * (e.g. getCommit, getBlob).
 */
export type GitBucket = Parameters<typeof gitStore.getCommit>[1];

/**
 * Cast a RepoBucketBinding (from the environment) to the GitBucket type
 * expected by git-smart helpers.
 */
export function toGitBucket(bucket: RepoBucketBinding): GitBucket {
  return bucket as unknown as GitBucket;
}
