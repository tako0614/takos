import type { Env } from '../../../shared/types';
export interface CustomDomainReverificationSummary {
    scanned: number;
    active: number;
    verifying: number;
    failed: number;
    expired: number;
    sslPromoted: number;
    errors: number;
}
export declare function runCustomDomainReverification(env: Env, options?: {
    batchSize?: number;
}): Promise<CustomDomainReverificationSummary>;
export interface ReconcileStuckDomainsSummary {
    scanned: number;
    cleaned: number;
    reset: number;
    errors: number;
}
export declare function reconcileStuckDomains(env: Env, options?: {
    staleThresholdMs?: number;
}): Promise<ReconcileStuckDomainsSummary>;
//# sourceMappingURL=custom-domain-maintenance.d.ts.map