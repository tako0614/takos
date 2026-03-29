/**
 * Git Smart service — public API.
 *
 * Drop-in replacement for git-store with native git object format (SHA-1).
 */
export type { GitObjectType, TreeEntry, GitSignature, GitCommit, GitTree, GitBlob, GitBranch, GitTag, GitCommitIndex, GitRepoFork, GitRepoRemote, CreateCommitParams, RefUpdateResult, MergeConflictType, MergeConflict, } from './git-objects';
export { FILE_MODES, SHA1_PATTERN, isValidSha } from './git-objects';
export { hashObject, hashBlob, hashTree, hashCommit, decodeObject, decodeTree, decodeCommit, encodeBlob, encodeTree, encodeCommit, encodeTreeContent, encodeCommitContent, } from './core/object';
export { sha1, hexToBytes, hexFromBuffer, concatBytes, } from './core/sha1';
export { putBlob, putTree, putCommit, putRawObject, getBlob, getTreeEntries, getCommitData, getObject, getRawObject, getCompressedObject, objectExists, deleteObject, deflate, inflate, } from './core/object-store';
export { getBranch, getBranchesByNames, getDefaultBranch, listBranches, isValidRefName, createBranch, updateBranch, deleteBranch, setDefaultBranch, getTag, listTags, createTag, deleteTag, resolveRef, listAllRefs, } from './core/refs';
export { createCommit, indexCommit, getCommitFromIndex, getCommit, getCommitLog, getCommitsFromRef, isAncestor, findMergeBase, countCommitsBetween, collectReachableObjects, collectReachableObjectShas, } from './core/commit-index';
export { isValidGitPath, assertValidGitPath, createTree, getTree, getEntryAtPath, listDirectory, getBlobAtPath, buildTreeFromPaths, applyTreeChanges, flattenTree, createEmptyTree, createSingleFileTree, } from './core/tree-ops';
export { mergeTrees3Way, } from './core/merge';
export { resolveReadableCommitFromRef, type ResolveReadableCommitResult, type ResolveReadableCommitFailureReason, } from './core/readable-commit';
export { initRepository, forkRepository, checkSyncStatus, commitFile, } from './operations';
//# sourceMappingURL=index.d.ts.map