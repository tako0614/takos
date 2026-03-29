import type { D1Database, R2Bucket } from '../../../shared/types/bindings.ts';
type OffloadEnv = {
    DB: D1Database;
    TENANT_SOURCE?: R2Bucket;
    TAKOS_OFFLOAD?: R2Bucket;
};
export interface R2OrphanedObjectGcSummary {
    skipped: boolean;
    reason?: string;
    dry_run: boolean;
    started_at: string;
    min_age_minutes: number;
    scanned: {
        blobs: number;
        trees: number;
    };
    candidates: {
        blobs: number;
        trees: number;
    };
    deleted: {
        blobs: number;
        trees: number;
    };
    next_cursors: {
        blobs?: string;
        trees?: string;
    };
}
export declare function runR2OrphanedObjectGcBatch(env: OffloadEnv, options?: {
    dryRun?: boolean;
    listLimit?: number;
    maxDeletes?: number;
    minAgeMinutes?: number;
}): Promise<R2OrphanedObjectGcSummary>;
export {};
//# sourceMappingURL=orphaned-object-gc.d.ts.map