/**
 * Git Sync Operations
 *
 * Handles Git store-based file synchronization: reading files from Git store
 * for session initialization, and committing snapshots back to the Git store.
 */
import type { D1Database, R2Bucket } from '../../../shared/types/bindings.ts';
import type { SessionFileEntry, SyncResult, SessionRepoMount, SessionSnapshot } from './git-sync-types';
export type { SessionFileEntry, SyncResult } from './git-sync-types';
/** Extract an error message from a failed HTTP response. */
export declare function extractResponseError(response: Response, fallbackMessage: string): Promise<string>;
export declare function toBase64(data: Uint8Array): string;
export declare function fromBase64(data: string): Uint8Array;
/** Build the list of file entries from a Git repository for session initialization. */
export declare function buildRepoFiles(db: D1Database, bucket: R2Bucket, repo: SessionRepoMount): Promise<SessionFileEntry[]>;
/** Commit a snapshot to the Git store for a specific repository. */
export declare function syncSnapshotToRepo(db: D1Database, bucket: R2Bucket, snapshot: SessionSnapshot, options: {
    repoId: string;
    repoName?: string;
    branch?: string;
    pathPrefix?: string;
    message: string;
    author?: {
        name: string;
        email: string;
    };
}): Promise<SyncResult>;
//# sourceMappingURL=git-sync.d.ts.map