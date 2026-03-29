import type { Env } from '../../../shared/types';
export interface SnapshotGcSpaceResult {
    spaceId: string;
    deletedBlobs: number;
    deletedSnapshots: number;
    deletedSessionFiles: number;
    error?: string;
}
export interface SnapshotGcBatchSummary {
    candidates: {
        sessions: number;
        blobs: number;
        oldSnapshots: number;
    };
    processed: number;
    deletedBlobs: number;
    deletedSnapshots: number;
    deletedSessionFiles: number;
    errors: number;
    spaces: SnapshotGcSpaceResult[];
}
export declare function runSnapshotGcBatch(env: Env, options?: {
    maxSpaces?: number;
    candidateScanLimit?: number;
    staleSnapshotAgeMinutes?: number;
}): Promise<SnapshotGcBatchSummary>;
//# sourceMappingURL=snapshot-maintenance.d.ts.map