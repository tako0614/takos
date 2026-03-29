import type { D1Database, R2Bucket } from '../../../shared/types/bindings.ts';
export interface GitCommit {
    id: string;
    space_id: string;
    message: string;
    author_id: string;
    author_name: string;
    parent_id: string | null;
    files_changed: number;
    insertions: number;
    deletions: number;
    tree_hash: string;
    created_at: string;
}
export interface GitFileChange {
    id: string;
    commit_id: string;
    file_id: string;
    path: string;
    change_type: 'added' | 'modified' | 'deleted' | 'renamed';
    old_path: string | null;
    old_hash: string | null;
    new_hash: string | null;
    insertions: number;
    deletions: number;
}
export interface FileDiff {
    path: string;
    changeType: 'added' | 'modified' | 'deleted' | 'renamed';
    oldContent?: string;
    newContent?: string;
    hunks: DiffHunk[];
}
export interface DiffHunk {
    oldStart: number;
    oldLines: number;
    newStart: number;
    newLines: number;
    lines: DiffLine[];
}
export interface DiffLine {
    type: 'context' | 'add' | 'delete';
    content: string;
    oldLineNumber?: number;
    newLineNumber?: number;
}
export declare class GitService {
    private d1;
    private storage;
    constructor(d1: D1Database, storage: R2Bucket);
    commit(spaceId: string, message: string, authorId: string, authorName: string, paths?: string[]): Promise<GitCommit>;
    log(spaceId: string, options?: {
        limit?: number;
        offset?: number;
        path?: string;
    }): Promise<GitCommit[]>;
    getCommit(commitId: string): Promise<GitCommit | null>;
    getCommitChanges(commitId: string): Promise<GitFileChange[]>;
    diff(spaceId: string, _fromCommitId: string | null, toCommitId: string): Promise<FileDiff[]>;
    restore(spaceId: string, commitId: string, path: string): Promise<{
        success: boolean;
        message: string;
    }>;
    private toGitCommit;
    private toGitFileChange;
    private calculateTreeHash;
    private calculateDiffStats;
    private generateDiffHunks;
}
//# sourceMappingURL=git.d.ts.map