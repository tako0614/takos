/**
 * Shared types for WFP (Workers for Platforms) submodules.
 *
 * WFP is Cloudflare's multi-tenant worker deployment product. It allows a
 * platform (Takos) to manage per-tenant Cloudflare Workers inside a "dispatch
 * namespace" -- each tenant gets its own isolated worker with individually
 * assigned resource bindings (D1, R2, KV, Queues, Vectorize, etc.).
 *
 * These types define the internal contract between the facade (service.ts) and
 * the per-domain method modules.  They are NOT part of the public API.
 */
import type { CFAPIResponse, WFPConfig } from './client';
export interface WorkerBinding {
    type: 'plain_text' | 'secret_text' | 'd1' | 'r2_bucket' | 'kv_namespace' | 'queue' | 'analytics_engine' | 'workflow' | 'vectorize' | 'service' | 'durable_object_namespace';
    name: string;
    text?: string;
    database_id?: string;
    bucket_name?: string;
    namespace_id?: string;
    queue_name?: string;
    delivery_delay?: number;
    dataset?: string;
    workflow_name?: string;
    class_name?: string;
    script_name?: string;
    index_name?: string;
    service?: string;
    environment?: string;
}
/** Shape returned by the Cloudflare API GET /settings endpoint for bindings */
export interface CloudflareBindingRecord {
    type: string;
    name: string;
    text?: string;
    id?: string;
    database_id?: string;
    bucket_name?: string;
    namespace_id?: string;
    queue_name?: string;
    delivery_delay?: number;
    dataset?: string;
    workflow_name?: string;
    class_name?: string;
    script_name?: string;
    index_name?: string;
    service?: string;
    environment?: string;
}
/**
 * Subset of WFPService internals exposed to mixin modules so they can call the
 * Cloudflare API without depending on the full class.
 */
export interface WfpContext {
    readonly config: WFPConfig;
    scriptPath(workerName: string): string;
    accountPath(suffix: string): string;
    cfFetch<T>(path: string, options?: RequestInit, timeoutMs?: number): Promise<CFAPIResponse<T>>;
    cfFetchWithRetry<T>(path: string, options?: RequestInit, maxRetries?: number, timeoutMs?: number): Promise<CFAPIResponse<T>>;
    formatBinding(binding: WorkerBinding): Record<string, unknown>;
    formatBindingForUpdate(binding: WorkerBinding | CloudflareBindingRecord | Record<string, unknown>): Record<string, unknown>;
}
export interface CreateWorkerOptions {
    workerName: string;
    workerScript: string;
    bindings: WorkerBinding[];
    compatibility_date?: string;
    compatibility_flags?: string[];
    limits?: {
        cpu_ms?: number;
        subrequests?: number;
    };
    /** JWT from assets upload completion (for static assets) */
    assetsJwt?: string;
}
/** Result shape returned by D1 query API */
export interface D1QueryResult<T> {
    results: T[];
}
//# sourceMappingURL=wfp-contracts.d.ts.map