import type { Env } from '../../../shared/types';
import type { SnapshotManager } from './snapshot';
/**
 * Clean up old pending/failed snapshots (call periodically or on startup).
 */
export declare function cleanupPendingSnapshots(manager: SnapshotManager, env: Env, spaceId: string, maxAgeMinutes?: number): Promise<number>;
export declare function getReachableSnapshots(env: Env, spaceId: string, headSnapshotId: string): Promise<Set<string>>;
/**
 * Run garbage collection on orphaned blobs and session data.
 */
export declare function runGC(manager: SnapshotManager, env: Env, spaceId: string): Promise<{
    deletedBlobs: number;
    deletedSnapshots: number;
    deletedSessionFiles: number;
}>;
//# sourceMappingURL=snapshot-cleanup.d.ts.map