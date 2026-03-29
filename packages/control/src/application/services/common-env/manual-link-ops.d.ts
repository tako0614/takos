import type { Env } from '../../../shared/types';
import type { D1TransactionManager } from '../../../shared/utils/db-transaction';
import { type CommonEnvAuditActor } from './audit';
import type { CommonEnvOrchestrator } from './orchestrator';
export interface ManualLinkDeps {
    env: Env;
    txManager: D1TransactionManager;
    orchestrator: CommonEnvOrchestrator;
}
export declare function upsertServiceTakosAccessTokenConfig(deps: ManualLinkDeps, params: {
    spaceId: string;
    serviceId: string;
    scopes: string[];
}): Promise<void>;
export declare function deleteServiceTakosAccessTokenConfig(deps: ManualLinkDeps, params: {
    spaceId: string;
    serviceId: string;
}): Promise<void>;
export declare function deleteServiceTakosAccessTokenConfigs(deps: ManualLinkDeps, params: {
    spaceId: string;
    serviceIds: string[];
}): Promise<void>;
export declare function listManualLinkKeys(deps: ManualLinkDeps, spaceId: string, serviceId: string): Promise<Set<string>>;
export declare function mutateManualLinks(deps: ManualLinkDeps, params: {
    spaceId: string;
    serviceId: string;
    toAdd: string[];
    toRemove: string[];
    actor?: CommonEnvAuditActor;
    trigger: 'manual_links_set' | 'manual_links_patch';
}): Promise<{
    added: string[];
    removed: string[];
}>;
export declare function setServiceManualLinks(deps: ManualLinkDeps, params: {
    spaceId: string;
    serviceId: string;
    keys: string[];
    actor?: CommonEnvAuditActor;
}): Promise<void>;
export declare function patchServiceManualLinks(deps: ManualLinkDeps, params: {
    spaceId: string;
    serviceId: string;
    add?: string[];
    remove?: string[];
    set?: string[];
    actor?: CommonEnvAuditActor;
}): Promise<{
    added: string[];
    removed: string[];
}>;
export declare function markRequiredKeysLocallyOverriddenForService(deps: ManualLinkDeps, params: {
    spaceId: string;
    serviceId: string;
    keys: string[];
    actor?: CommonEnvAuditActor;
}): Promise<void>;
//# sourceMappingURL=manual-link-ops.d.ts.map