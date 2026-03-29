export type GitObjectType = 'blob' | 'tree' | 'commit' | 'tag';
export interface TreeEntry {
    mode: string;
    name: string;
    sha: string;
}
export interface GitSignature {
    name: string;
    email: string;
    timestamp: number;
    tzOffset: string;
}
export interface GitCommit {
    sha: string;
    tree: string;
    parents: string[];
    author: GitSignature;
    committer: GitSignature;
    message: string;
}
export interface GitTree {
    sha: string;
    entries: TreeEntry[];
}
export interface GitBlob {
    sha: string;
    content: Uint8Array;
    size: number;
}
export interface GitBranch {
    id: string;
    repo_id: string;
    name: string;
    commit_sha: string;
    is_default: boolean;
    is_protected: boolean;
    created_at: string;
    updated_at: string;
}
export interface GitTag {
    id: string;
    repo_id: string;
    name: string;
    commit_sha: string;
    message: string | null;
    tagger_name: string | null;
    tagger_email: string | null;
    created_at: string;
}
export interface GitCommitIndex {
    id: string;
    repo_id: string;
    sha: string;
    tree_sha: string;
    parent_shas: string | null;
    author_name: string;
    author_email: string;
    author_date: string;
    committer_name: string;
    committer_email: string;
    commit_date: string;
    message: string;
}
export interface GitRepoFork {
    id: string;
    fork_repo_id: string;
    upstream_repo_id: string;
    created_at: string;
}
export interface GitRepoRemote {
    id: string;
    repo_id: string;
    name: string;
    upstream_repo_id: string;
    created_at: string;
}
export interface CreateCommitParams {
    tree: string;
    parents: string[];
    message: string;
    author?: GitSignature;
    committer?: GitSignature;
}
export interface RefUpdateResult {
    success: boolean;
    current?: string;
    error?: string;
}
export type MergeConflictType = 'content' | 'delete-modify' | 'add-add';
export interface MergeConflict {
    path: string;
    type: MergeConflictType;
}
export declare const FILE_MODES: {
    readonly REGULAR_FILE: "100644";
    readonly EXECUTABLE: "100755";
    readonly SYMLINK: "120000";
    readonly DIRECTORY: "040000";
};
/** SHA-1 hex pattern (40 lowercase hex chars) */
export declare const SHA1_PATTERN: RegExp;
/** Validate a SHA-1 hex string */
export declare function isValidSha(sha: string): boolean;
//# sourceMappingURL=git-objects.d.ts.map