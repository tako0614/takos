import type { AuthenticatedRouteEnv } from '../route-auth';
export type FileStatus = 'added' | 'modified' | 'deleted';
export type RepoDiffFile = {
    path: string;
    status: FileStatus;
    additions: number;
    deletions: number;
};
type DiffLine = {
    type: 'context' | 'addition' | 'deletion';
    content: string;
    old_line?: number;
    new_line?: number;
};
type DiffHunk = {
    old_start: number;
    old_lines: number;
    new_start: number;
    new_lines: number;
    lines: DiffLine[];
};
export type DetailedDiffFile = RepoDiffFile & {
    hunks: DiffHunk[];
};
export type RepoDiffPayload = {
    base: string;
    head: string;
    files: RepoDiffFile[];
    stats: {
        total_additions: number;
        total_deletions: number;
        files_changed: number;
    };
};
export declare function buildRepoDiffPayload(env: AuthenticatedRouteEnv['Bindings'], repoId: string, baseRef: string, headRef: string): Promise<RepoDiffPayload | null>;
export declare function buildDetailedRepoDiffPayload(env: AuthenticatedRouteEnv['Bindings'], repoId: string, baseRef: string, headRef: string): Promise<{
    success: true;
    payload: {
        base: string;
        head: string;
        files: DetailedDiffFile[];
        stats: RepoDiffPayload['stats'];
        truncated: boolean;
    };
} | {
    success: false;
    status: 404 | 422 | 500;
    body: {
        error: string;
        message?: string;
    };
}>;
export {};
//# sourceMappingURL=diff.d.ts.map