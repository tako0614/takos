/**
 * Shared Git bucket type aliases and conversion helpers.
 *
 * These are used by both server routes and application services,
 * so they live in the shared layer to avoid cross-boundary imports.
 */
import type { Env } from "../types/index.ts";

/** The concrete object-store-like binding type used by Env.GIT_OBJECTS. */
export type RepoBucketBinding = NonNullable<Env["GIT_OBJECTS"]>;

/** The object-store binding used by repository object readers. */
export type GitBucket = RepoBucketBinding;

/**
 * Cast a RepoBucketBinding (from the environment) to the GitBucket type
 * expected by repository object readers.
 */
export function toGitBucket(bucket: RepoBucketBinding): GitBucket {
  return bucket;
}
