/**
 * Deployment orchestration methods for the WFP (Workers for Platforms) service.
 *
 * Coordinates high-level tenant provisioning workflows: fetching a worker
 * bundle (from R2), mapping generic binding descriptors into WFP-specific
 * WorkerBinding shapes, and deploying the assembled worker into the dispatch
 * namespace. Also provides the canonical D1 migration SQL for new tenants.
 */
import type { Env } from '../../../shared/types';
import type { WfpContext, WorkerBinding } from './wfp-contracts';
/**
 * Deploy a worker with bindings from a bundle URL or pre-built script.
 */
export declare function deployWorkerWithBindings(ctx: WfpContext, createWorkerFn: (options: {
    workerName: string;
    workerScript: string;
    bindings: WorkerBinding[];
    compatibility_date?: string;
    compatibility_flags?: string[];
    assetsJwt?: string;
}) => Promise<void>, workerName: string, options: {
    bindings: Array<{
        type: string;
        name: string;
        text?: string;
        id?: string;
        bucket_name?: string;
        namespace_id?: string;
        index_name?: string;
        queue_name?: string;
        delivery_delay?: number;
        dataset?: string;
        workflow_name?: string;
        class_name?: string;
        script_name?: string;
    }>;
    bundleUrl?: string;
    bundleScript?: string;
    compatibilityDate?: string;
    compatibilityFlags?: string[];
    /** JWT from assets upload (for static assets) */
    assetsJwt?: string;
}): Promise<void>;
/**
 * Get the takos worker script bundle.
 *
 * Priority:
 * 1. R2 bucket (required)
 *
 * Embedded fallback is intentionally disabled to avoid silently deploying
 * stale worker bundles that drift from yurucommu source.
 */
export declare function getTakosWorkerScript(env: Pick<Env, 'WORKER_BUNDLES'>): Promise<string>;
/**
 * Get the D1 migration SQL for takos tenant database.
 */
export declare function getTakosMigrationSQL(): string;
//# sourceMappingURL=orchestrator.d.ts.map