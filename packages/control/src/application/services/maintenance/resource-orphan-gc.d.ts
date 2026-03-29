import type { Env } from '../../../shared/types';
export interface ResourceOrphanGcSummary {
    deleted: number;
    failed: number;
    cutoffTime: string;
    gracePeriodDays: number;
}
/**
 * Garbage-collect orphaned app deployment resources.
 * Resources are marked as orphaned (orphaned_at set) when removed from a manifest during update.
 * After the grace period, this job permanently deletes the Cloudflare resource and DB record.
 */
export declare function gcOrphanedResources(env: Pick<Env, 'DB' | 'CF_ACCOUNT_ID' | 'CF_API_TOKEN' | 'WFP_DISPATCH_NAMESPACE'>, options?: {
    gracePeriodDays?: number;
}): Promise<ResourceOrphanGcSummary>;
//# sourceMappingURL=resource-orphan-gc.d.ts.map