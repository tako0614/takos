/**
 * Takos Git facade for control route handlers.
 *
 * Route modules import Git helpers through this boundary while Takos Git
 * service ownership remains explicit.
 */
import type { Env } from "../../../shared/types/index.ts";
import type { getCommit } from "./local/index.ts";

export type RepoBucketBinding = NonNullable<Env["GIT_OBJECTS"]>;
export type GitBucket = Parameters<typeof getCommit>[1];

export function toGitBucket(bucket: RepoBucketBinding): GitBucket {
  return bucket;
}

export type {
  GitCommit,
  GitSignature,
  ResolveReadableCommitResult,
} from "./local/index.ts";

export {
  applyTreeChanges,
  buildTreeFromPaths,
  checkSyncStatus,
  collectReachableObjects,
  collectReachableObjectShas,
  countCommitsBetween,
  createBranch,
  createCommit,
  createTag,
  deleteBranch,
  deleteObject,
  FILE_MODES,
  findMergeBase,
  flattenTree,
  forkRepository,
  getBlob,
  getBlobAtPath,
  getBranch,
  getBranchesByNames,
  getCommit,
  getCommitData,
  getCommitsFromIndex,
  getCommitsFromRef,
  getDefaultBranch,
  getEntryAtPath,
  indexCommit,
  initRepository,
  isAncestor,
  isValidGitPath,
  isValidRefName,
  listAllRefs,
  listBranches,
  listDirectory,
  listTags,
  mergeTrees3Way,
  putBlob,
  resolveReadableCommitFromRef,
  resolveRef,
  setDefaultBranch,
  updateBranch,
} from "./local/index.ts";
