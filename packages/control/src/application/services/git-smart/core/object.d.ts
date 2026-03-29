/**
 * Git object encode/decode — native git format.
 *
 * Git object layout: "<type> <size>\0<content>"
 * - blob: raw bytes
 * - tree: binary entries "<mode> <name>\0<20-byte-sha>"
 * - commit: text format "tree <sha>\nparent <sha>\nauthor ...\ncommitter ...\n\n<message>"
 */
import type { GitObjectType, TreeEntry, GitCommit, GitSignature } from '../git-objects';
export declare function encodeBlob(content: Uint8Array): Uint8Array;
export declare function encodeTree(entries: TreeEntry[]): Uint8Array;
export declare function encodeTreeContent(entries: TreeEntry[]): Uint8Array;
export declare function encodeCommit(commit: {
    tree: string;
    parents: string[];
    author: GitSignature;
    committer: GitSignature;
    message: string;
}): Uint8Array;
export declare function encodeCommitContent(commit: {
    tree: string;
    parents: string[];
    author: GitSignature;
    committer: GitSignature;
    message: string;
}): Uint8Array;
export declare function hashObject(type: GitObjectType, content: Uint8Array): Promise<string>;
export declare function hashBlob(content: Uint8Array): Promise<string>;
export declare function hashTree(entries: TreeEntry[]): Promise<string>;
export declare function hashCommit(commit: {
    tree: string;
    parents: string[];
    author: GitSignature;
    committer: GitSignature;
    message: string;
}): Promise<string>;
export declare function decodeObjectHeader(raw: Uint8Array): {
    type: GitObjectType;
    size: number;
    contentOffset: number;
};
export declare function decodeObject(raw: Uint8Array): {
    type: GitObjectType;
    content: Uint8Array;
};
export declare function decodeTree(content: Uint8Array): TreeEntry[];
export declare function decodeCommit(content: Uint8Array): GitCommit;
//# sourceMappingURL=object.d.ts.map