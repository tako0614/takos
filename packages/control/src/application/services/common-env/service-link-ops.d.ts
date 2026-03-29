import type { Env } from '../../../shared/types';
import type { D1TransactionManager } from '../../../shared/utils/db-transaction';
import { type CommonEnvAuditActor } from './audit';
import { type LinkSource, type SyncState } from './repository';
import { type TakosBuiltinStatus } from './takos-builtins';
export interface ServiceLinkDeps {
    env: Env;
    txManager: D1TransactionManager;
}
export declare function ensureRequiredServiceLinks(deps: ServiceLinkDeps, params: {
    spaceId: string;
    serviceIds: string[];
    keys: string[];
    actor?: CommonEnvAuditActor;
}): Promise<void>;
export declare function listServiceCommonEnvLinks(deps: ServiceLinkDeps, spaceId: string, serviceId: string): Promise<Array<{
    name: string;
    source: LinkSource;
    hasCommonValue: boolean;
    syncState: SyncState;
    syncReason: string | null;
}>>;
export declare function listServiceManualLinkNames(deps: ServiceLinkDeps, spaceId: string, serviceId: string): Promise<string[]>;
export declare function listServiceBuiltins(deps: ServiceLinkDeps, spaceId: string, serviceId: string): Promise<Record<string, TakosBuiltinStatus>>;
//# sourceMappingURL=service-link-ops.d.ts.map