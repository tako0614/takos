/**
 * Tree operations — navigate, flatten, build, and apply changes.
 *
 * Adapted from git-store/tree.ts for native git tree format.
 */
import type { R2Bucket } from '../../../../shared/types/bindings.ts';
import type { TreeEntry } from '../git-objects';
export declare function isValidGitPath(path: string): boolean;
export declare function assertValidGitPath(path: string): string;
export declare function createTree(bucket: R2Bucket, entries: TreeEntry[]): Promise<string>;
export declare function getTree(bucket: R2Bucket, sha: string): Promise<{
    sha: string;
    entries: TreeEntry[];
} | null>;
export declare function getEntryAtPath(bucket: R2Bucket, rootTreeSha: string, path: string): Promise<(TreeEntry & {
    type: 'blob' | 'tree';
}) | null>;
export declare function listDirectory(bucket: R2Bucket, rootTreeSha: string, path?: string): Promise<TreeEntry[] | null>;
export declare function getBlobAtPath(bucket: R2Bucket, rootTreeSha: string, path: string): Promise<Uint8Array | null>;
export declare function buildTreeFromPaths(bucket: R2Bucket, files: Array<{
    path: string;
    sha: string;
    mode?: string;
}>): Promise<string>;
export declare function applyTreeChanges(bucket: R2Bucket, baseTreeSha: string, changes: Array<{
    path: string;
    operation: 'add' | 'modify' | 'delete';
    sha?: string;
    mode?: string;
}>): Promise<string>;
export declare function flattenTree(bucket: R2Bucket, treeSha: string, basePath?: string, options?: {
    maxDepth?: number;
    maxEntries?: number;
    skipSymlinks?: boolean;
}): Promise<Array<{
    path: string;
    sha: string;
    mode: string;
}>>;
export declare function createEmptyTree(bucket: R2Bucket): Promise<string>;
export declare function createSingleFileTree(bucket: R2Bucket, fileName: string, content: Uint8Array): Promise<string>;
//# sourceMappingURL=tree-ops.d.ts.map