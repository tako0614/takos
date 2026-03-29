import type { Env } from '../../../shared/types';
export type LinkSource = 'manual' | 'required';
export type SyncState = 'pending' | 'managed' | 'overridden' | 'missing_common' | 'missing_builtin' | 'error';
export interface ReconcileUpdate {
    rowId: string;
    lastAppliedFingerprint?: string | null;
    syncState?: SyncState;
    syncReason?: string | null;
    lastObservedFingerprint?: string | null;
    lastSyncError?: string | null;
}
export interface SpaceEnvRow {
    id: string;
    space_id: string;
    name: string;
    value_encrypted: string;
    is_secret: boolean;
    created_at: string;
    updated_at: string;
}
export interface CommonEnvServiceRow {
    id: string;
    space_id: string;
    route_ref: string | null;
}
export interface ServiceLinkRow {
    id: string;
    space_id: string;
    service_id: string;
    env_name: string;
    source: LinkSource;
    last_applied_fingerprint: string | null;
    sync_state: SyncState;
    sync_reason: string | null;
    last_observed_fingerprint: string | null;
    last_reconciled_at: string | null;
    last_sync_error: string | null;
    created_at: string;
    updated_at: string;
}
export type WorkerRow = CommonEnvServiceRow;
export type WorkerLinkRow = ServiceLinkRow;
export declare function listSpaceEnvRows(env: Pick<Env, 'DB'>, spaceId: string): Promise<SpaceEnvRow[]>;
export declare function listSpaceCommonEnvNames(env: Pick<Env, 'DB'>, spaceId: string): Promise<string[]>;
export declare function listServiceLinks(env: Pick<Env, 'DB'>, spaceId: string, serviceId: string): Promise<ServiceLinkRow[]>;
export declare function listServiceIdsLinkedToEnvKey(env: Pick<Env, 'DB'>, spaceId: string, envName: string): Promise<string[]>;
export declare function getService(env: Pick<Env, 'DB'>, spaceId: string, serviceId: string): Promise<CommonEnvServiceRow | null>;
export declare function updateLinkRuntime(env: Pick<Env, 'DB'>, update: ReconcileUpdate): Promise<void>;
//# sourceMappingURL=repository.d.ts.map