import type { KvStoreBinding } from '../../../shared/types/bindings.ts';
/**
 * Record a request outcome for rollout health tracking.
 * Uses per-isolate unique keys to avoid KV read-modify-write race conditions.
 * Each call writes a new KV entry; getErrorRate aggregates them.
 */
export declare function recordRequestOutcome(kv: KvStoreBinding, artifactRef: string, isError: boolean): Promise<void>;
/**
 * Get aggregated error rate for a deployment over the given time window.
 */
export declare function getErrorRate(kv: KvStoreBinding, artifactRef: string, windowMinutes?: number): Promise<{
    errorRate: number;
    totalRequests: number;
    totalErrors: number;
}>;
//# sourceMappingURL=rollout-health.d.ts.map