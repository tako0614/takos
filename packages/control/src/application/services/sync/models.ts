export interface Session {
    id: string;
    space_id: string;
    base_snapshot_id: string;
    head_snapshot_id?: string;
    status: 'initializing' | 'running' | 'stopped' | 'merged' | 'discarded' | 'dead' | 'failed';
    last_heartbeat?: string;
    repo_id?: string;
    branch?: string;
    created_at: string;
    updated_at: string;
}

export interface Snapshot {
    id: string;
    space_id: string;
    parent_ids: string[]; // JSON array in DB
    tree_key: string;
    message?: string;
    author?: 'user' | 'ai';
    status: 'pending' | 'complete' | 'failed';
    created_at: string;
}

export interface TreeEntry {
    hash: string;
    mode: number; // 0o644 or 0o755
    type: 'file' | 'symlink';
    target?: string; // for symlinks
    size: number;
    hasConflict?: boolean;
}

export type SnapshotTree = Record<string, TreeEntry>; // path -> entry

export interface Change {
    path: string;
    type: 'add' | 'modify' | 'delete';
    old_entry?: TreeEntry;
    new_entry?: TreeEntry;
}

export interface Conflict {
    path: string;
    type: 'add_add' | 'delete_modify' | 'type_conflict' | 'content_conflict' | 'mode_conflict' | 'missing_blob';
    base_entry?: TreeEntry;
    workspace_entry?: TreeEntry;
    session_entry?: TreeEntry;
    missing_blob?: {
        version: 'base' | 'workspace' | 'session';
        hash: string;
    };
}

export interface MergeResult {
    ok: boolean;
    entry?: TreeEntry | null; // null means delete
    conflict?: Conflict['type'];
}

/**
 * Function to fetch blob content by hash
 */
export type BlobFetcher = (hash: string) => Promise<string | null>;

