/**
 * Git Smart service — public API.
 *
 * Drop-in replacement for git-store with native git object format (SHA-1).
 */

// --- Types ---
export * from './types';

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
} from './core/object';

export {
  sha1,
  hexToBytes,
  hexFromBuffer,
  concatBytes,
} from './core/sha1';

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
} from './core/object-store';

// --- Refs ---
export {
  getBranch,
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
} from './core/refs';

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
} from './core/commit-index';

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
} from './core/tree-ops';

// --- Merge ---
export {
  mergeTrees3Way,
} from './core/merge';

// --- Readable commit ---
export {
  resolveReadableCommitFromRef,
  type ResolveReadableCommitResult,
  type ResolveReadableCommitFailureReason,
} from './core/readable-commit';

// --- High-level operations ---
export {
  initRepository,
  forkRepository,
  checkSyncStatus,
  commitFile,
} from './operations';
