/**
 * Routing Service
 *
 * Hostname routing resolution, upsert, and deletion.
 * Delegates to resolver (pure parsing/selection) and cache (L1/L2/DO) modules.
 */
import type { ResolvedRouting, RoutingBindings, RoutingTarget } from './routing-models';
import type { PlatformExecutionContext } from '../../../shared/types/bindings.ts';
export type { RoutingBindings } from './routing-models';
export { selectRouteRefFromRoutingTarget, selectDeploymentTargetFromRoutingTarget, selectHttpEndpointFromHttpEndpointSet, selectRouteRefFromHttpEndpointSet, parseRoutingValue, normalizeHostname, } from './resolver';
export { getRoutingPhase } from './phase';
export declare function resolveHostnameRouting(options: {
    env: RoutingBindings;
    hostname: string;
    executionCtx?: PlatformExecutionContext;
    timeoutMs?: number;
}): Promise<ResolvedRouting>;
export declare function upsertHostnameRouting(options: {
    env: RoutingBindings;
    hostname: string;
    target: RoutingTarget;
    executionCtx?: PlatformExecutionContext;
    timeoutMs?: number;
}): Promise<void>;
export declare function deleteHostnameRouting(options: {
    env: RoutingBindings;
    hostname: string;
    executionCtx?: PlatformExecutionContext;
    tombstoneTtlMs?: number;
    timeoutMs?: number;
}): Promise<void>;
//# sourceMappingURL=service.d.ts.map