import type { D1Database, R2Bucket } from '../../../shared/types/bindings.ts';
type BackupEnv = {
    DB: D1Database;
    TAKOS_OFFLOAD?: R2Bucket;
    CF_ACCOUNT_ID?: string;
    CF_API_TOKEN?: string;
};
type OffloadEnv = {
    TAKOS_OFFLOAD?: R2Bucket;
};
export interface D1BackupSummary {
    skipped: boolean;
    reason?: string;
    key?: string;
    bytes?: number;
    sha256?: string;
    deleted_old_backups?: number;
}
export interface BackupIntegrityCheckSummary {
    skipped: boolean;
    reason?: string;
    key?: string;
    bytes?: number;
    sha256?: string;
    expected_sha256?: string;
}
export interface BackupInventorySummary {
    skipped: boolean;
    reason?: string;
    prefix?: string;
    objects?: number;
    total_bytes?: number;
    oldest_key?: string | null;
    newest_key?: string | null;
}
export declare function runD1DailyBackup(env: BackupEnv, options?: {
    retentionDays?: number;
    force?: boolean;
}): Promise<D1BackupSummary>;
export declare function runD1BackupInventory(env: OffloadEnv, options?: {
    force?: boolean;
}): Promise<BackupInventorySummary>;
export declare function runD1BackupIntegrityCheck(env: OffloadEnv, options?: {
    force?: boolean;
}): Promise<BackupIntegrityCheckSummary>;
export {};
//# sourceMappingURL=backup-maintenance.d.ts.map