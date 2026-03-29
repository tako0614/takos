import type { Env } from '../../../shared/types';
import type { Snapshot, SnapshotTree, BlobFetcher } from './models';
import { SnapshotStorage } from './snapshot-storage';
export declare class SnapshotManager {
    private env;
    private spaceId;
    private storage;
    constructor(env: Env, spaceId: string, storage?: SnapshotStorage);
    /**
     * Create a new snapshot from a tree.
     * Creates snapshot in 'pending' status; call completeSnapshot() after
     * successful DB updates to mark as 'complete'.
     */
    createSnapshot(tree: SnapshotTree, parentIds: string[], message?: string, author?: 'user' | 'ai'): Promise<Snapshot>;
    /**
     * Mark a pending snapshot as complete after related DB updates have succeeded.
     */
    completeSnapshot(snapshotId: string): Promise<void>;
    /**
     * Mark a pending snapshot as failed and clean up.
     * Call this if DB updates fail after snapshot creation.
     */
    failSnapshot(snapshotId: string): Promise<void>;
    /**
     * Clean up old pending/failed snapshots (call periodically or on startup).
     * Delegates to standalone cleanupPendingSnapshots function.
     */
    cleanupPendingSnapshots(maxAgeMinutes?: number): Promise<number>;
    /**  Get a snapshot by ID. */
    getSnapshot(snapshotId: string): Promise<Snapshot | null>;
    /** Validate tree structure (checks a sample of entries). */
    private validateTree;
    /** Get the tree for a snapshot (with integrity verification). */
    getTree(snapshotId: string): Promise<SnapshotTree>;
    /** Create a tree from current workspace files table. */
    createTreeFromWorkspace(): Promise<SnapshotTree>;
    /** Create a blob fetcher for this workspace (with integrity check). */
    createBlobFetcher(): BlobFetcher;
    /** Write a blob and return its hash and size. Refcount starts at 1. */
    writeBlob(content: string): Promise<{
        hash: string;
        size: number;
    }>;
    /** Increase refcount for blobs included in a snapshot. */
    increaseBlobRefcount(hashes: string[]): Promise<void>;
    /** Decrease refcount for blobs and delete those that reach zero. */
    decreaseBlobRefcount(hashes: string[]): Promise<void>;
    /** Get all snapshots reachable from a head snapshot (DAG traversal). Delegates to standalone function. */
    getReachableSnapshots(headSnapshotId: string): Promise<Set<string>>;
    /** Run garbage collection on orphaned blobs and session data. Delegates to standalone function. */
    runGC(): Promise<{
        deletedBlobs: number;
        deletedSnapshots: number;
        deletedSessionFiles: number;
    }>;
    /** Delete blobs from storage (exposed for cleanup functions). */
    deleteBlobs(hashes: string[]): Promise<void>;
    /** Delete a tree from storage (exposed for cleanup functions). */
    deleteTree(treeKey: string): Promise<void>;
}
//# sourceMappingURL=snapshot.d.ts.map