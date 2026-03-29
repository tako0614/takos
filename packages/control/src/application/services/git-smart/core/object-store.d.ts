/**
 * Git object storage on Cloudflare R2.
 *
 * Key format: git/v2/objects/<sha1[0:2]>/<sha1[2:]>
 * Content: zlib-deflated git loose object (type size\0content)
 *
 * Uses CompressionStream/DecompressionStream (built into Workers runtime).
 */
import type { R2Bucket } from '../../../../shared/types/bindings.ts';
import type { GitObjectType, TreeEntry, GitCommit, GitSignature } from '../git-objects';
declare function getObjectKey(sha: string): string;
declare function deflate(data: Uint8Array): Promise<Uint8Array>;
declare function inflate(data: Uint8Array): Promise<Uint8Array>;
export declare function putBlob(bucket: R2Bucket, content: Uint8Array): Promise<string>;
export declare function putTree(bucket: R2Bucket, entries: TreeEntry[]): Promise<string>;
export declare function putCommit(bucket: R2Bucket, commit: {
    tree: string;
    parents: string[];
    author: GitSignature;
    committer: GitSignature;
    message: string;
}): Promise<string>;
/**
 * Store a raw git object (already includes type+size header) by computing SHA and storing compressed.
 */
export declare function putRawObject(bucket: R2Bucket, raw: Uint8Array): Promise<string>;
export declare function getRawObject(bucket: R2Bucket, sha: string): Promise<Uint8Array | null>;
export declare function getObject(bucket: R2Bucket, sha: string): Promise<{
    type: GitObjectType;
    content: Uint8Array;
} | null>;
export declare function getBlob(bucket: R2Bucket, sha: string): Promise<Uint8Array | null>;
export declare function getTreeEntries(bucket: R2Bucket, sha: string): Promise<TreeEntry[] | null>;
export declare function getCommitData(bucket: R2Bucket, sha: string): Promise<GitCommit | null>;
export declare function objectExists(bucket: R2Bucket, sha: string): Promise<boolean>;
/**
 * Get the compressed (deflated) bytes for an object, suitable for packfile construction.
 */
export declare function getCompressedObject(bucket: R2Bucket, sha: string): Promise<Uint8Array | null>;
export declare function deleteObject(bucket: R2Bucket, sha: string): Promise<void>;
export { deflate, inflate, getObjectKey };
//# sourceMappingURL=object-store.d.ts.map