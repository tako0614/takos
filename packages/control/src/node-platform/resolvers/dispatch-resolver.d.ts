import type { DispatchEnv } from '../../dispatch.ts';
import type { D1Database, R2Bucket } from '../../shared/types/bindings.ts';
import { type TenantWorkerRuntimeRegistry } from '../../local-platform/tenant-worker-runtime.ts';
import type { PgPool } from './ai-resolver.ts';
export declare function collectImplicitForwardTargets(): Record<string, string>;
export interface DispatchBuildContext {
    dataDir: string | null;
    db: D1Database;
    workerBundles: R2Bucket;
    encryptionKey: string;
    pgPool: PgPool | undefined;
    forwardTargets: Record<string, string>;
    dispatchRegistries: Set<TenantWorkerRuntimeRegistry>;
}
export declare function buildDispatcher(ctx: DispatchBuildContext): Promise<DispatchEnv['DISPATCHER']>;
//# sourceMappingURL=dispatch-resolver.d.ts.map