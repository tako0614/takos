/**
 * Git Smart service — public API.
 *
 * Drop-in replacement for git-store with native git object format (SHA-1).
 */

// --- Types ---
export type {
  GitObjectType,
  TreeEntry,
  GitSignature,
  GitCommit,
  GitTree,
  GitBlob,
  GitBranch,
  GitTag,
  GitCommitIndex,
  GitRepoFork,
  GitRepoRemote,
  CreateCommitParams,
  RefUpdateResult,
  MergeConflictType,
  MergeConflict,
} from './git-objects.ts';
export { FILE_MODES, SHA1_PATTERN, isValidSha } from './git-objects.ts';

// --- Core object operations ---
export {
  hashObject,
  hashBlob,
  hashTree,
  hashCommit,
  decodeObject,
  decodeTree,
  decodeCommit,
  encodeBlob,
  encodeTree,
  encodeCommit,
  encodeTreeContent,
  encodeCommitContent,
} from './core/object.ts';

export {
  sha1,
  hexToBytes,
  hexFromBuffer,
  concatBytes,
} from './core/sha1.ts';

// --- Object store ---
export {
  putBlob,
  putTree,
  putCommit,
  putRawObject,
  getBlob,
  getTreeEntries,
  getCommitData,
  getObject,
  getRawObject,
  getCompressedObject,
  objectExists,
  deleteObject,
  deflate,
  inflate,
} from './core/object-store.ts';

// --- Refs ---
export {
  getBranch,
  getBranchesByNames,
  getDefaultBranch,
  listBranches,
  isValidRefName,
  createBranch,
  updateBranch,
  deleteBranch,
  setDefaultBranch,
  getTag,
  listTags,
  createTag,
  deleteTag,
  resolveRef,
  listAllRefs,
} from './core/refs.ts';

// --- Commits ---
export {
  createCommit,
  indexCommit,
  getCommitFromIndex,
  getCommit,
  getCommitLog,
  getCommitsFromRef,
  isAncestor,
  findMergeBase,
  countCommitsBetween,
  collectReachableObjects,
  collectReachableObjectShas,
} from './core/commit-index.ts';

// --- Tree operations ---
export {
  isValidGitPath,
  assertValidGitPath,
  createTree,
  getTree,
  getEntryAtPath,
  listDirectory,
  getBlobAtPath,
  buildTreeFromPaths,
  applyTreeChanges,
  flattenTree,
  createEmptyTree,
  createSingleFileTree,
} from './core/tree-ops.ts';

// --- Merge ---
export {
  mergeTrees3Way,
} from './core/merge.ts';

// --- Readable commit ---
export {
  resolveReadableCommitFromRef,
  type ResolveReadableCommitResult,
  type ResolveReadableCommitFailureReason,
} from './core/readable-commit.ts';

// --- High-level operations ---
export {
  initRepository,
  forkRepository,
  checkSyncStatus,
  commitFile,
} from './operations.ts';
