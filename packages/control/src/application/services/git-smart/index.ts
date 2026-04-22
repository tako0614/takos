/**
 * Git Smart service — public API.
 *
 * Drop-in replacement for git-store with native git object format (SHA-1).
 */

// --- Types ---
export type {
  CreateCommitParams,
  GitBlob,
  GitBranch,
  GitCommit,
  GitCommitIndex,
  GitObjectType,
  GitRepoFork,
  GitRepoRemote,
  GitSignature,
  GitTag,
  GitTree,
  MergeConflict,
  MergeConflictType,
  RefUpdateResult,
  TreeEntry,
} from "./git-objects.ts";
export { FILE_MODES, isValidSha, SHA1_PATTERN } from "./git-objects.ts";

// --- Core object operations ---
export {
  decodeCommit,
  decodeObject,
  decodeTree,
  encodeBlob,
  encodeCommit,
  encodeCommitContent,
  encodeTree,
  encodeTreeContent,
  hashBlob,
  hashCommit,
  hashObject,
  hashTree,
} from "./core/object.ts";

export { concatBytes, hexFromBuffer, hexToBytes, sha1 } from "./core/sha1.ts";

// --- Object store ---
export {
  deflate,
  deleteObject,
  getBlob,
  getCommitData,
  getCompressedObject,
  getObject,
  getRawObject,
  getTreeEntries,
  inflate,
  objectExists,
  putBlob,
  putCommit,
  putRawObject,
  putTree,
} from "./core/object-store.ts";

// --- Refs ---
export {
  createBranch,
  createTag,
  deleteBranch,
  deleteTag,
  getBranch,
  getBranchesByNames,
  getDefaultBranch,
  getTag,
  isValidRefName,
  listAllRefs,
  listBranches,
  listTags,
  resolveRef,
  setDefaultBranch,
  updateBranch,
} from "./core/refs.ts";

// --- Commits ---
export {
  collectReachableObjects,
  collectReachableObjectShas,
  countCommitsBetween,
  createCommit,
  findMergeBase,
  getCommit,
  getCommitFromIndex,
  getCommitLog,
  getCommitsFromRef,
  indexCommit,
  isAncestor,
} from "./core/commit-index.ts";

// --- Tree operations ---
export {
  applyTreeChanges,
  assertValidGitPath,
  buildTreeFromPaths,
  createEmptyTree,
  createSingleFileTree,
  createTree,
  flattenTree,
  getBlobAtPath,
  getEntryAtPath,
  getTree,
  isValidGitPath,
  listDirectory,
} from "./core/tree-ops.ts";

// --- Merge ---
export { mergeTrees3Way } from "./core/merge.ts";

// --- Readable commit ---
export {
  type ResolveReadableCommitFailureReason,
  resolveReadableCommitFromRef,
  type ResolveReadableCommitResult,
} from "./core/readable-commit.ts";

// --- High-level operations ---
export {
  checkSyncStatus,
  commitFile,
  forkRepository,
  initRepository,
} from "./operations.ts";
