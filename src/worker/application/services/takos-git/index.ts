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
  getCommitsFromRef,
  getDefaultBranch,
  getEntryAtPath,
  indexCommit,
  initRepository,
  isAncestor,
  isValidGitPath,
  isValidRefName,
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
export { fetchPackFromRemote } from "./local/client/fetch-pack.ts";
export { fetchRemoteRefs } from "./local/client/fetch-refs.ts";
export { readPackfileAsync } from "./local/protocol/packfile-reader.ts";
export * from "./client.ts";
