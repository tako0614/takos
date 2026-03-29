/**
 * Routing Resolver
 *
 * Pure functions for parsing routing values, selecting deployment targets,
 * and matching HTTP endpoints. No I/O or caching — only data transformation.
 */
import type { ParsedRoutingValue, RoutingTarget, StoredHttpEndpoint, WeightedDeploymentTarget } from './routing-models';
export declare function toSingleDeploymentTarget(routeRef: string): RoutingTarget;
export declare function parseEpochMillis(raw: unknown): number | undefined;
export declare function coercePositiveInt(raw: unknown): number | null;
export declare function normalizeHostname(hostname: string): string;
/**
 * Select a concrete worker name from a routing target.
 *
 * - `deployments`: weighted random selection (weight-based)
 */
export declare function selectRouteRefFromRoutingTarget(target: RoutingTarget, options?: {
    random?: () => number;
}): string | null;
export declare function selectDeploymentTargetFromRoutingTarget(target: RoutingTarget, options?: {
    random?: () => number;
}): WeightedDeploymentTarget | null;
/**
 * Select a worker name from an http-endpoint-set routing target.
 * Uses longest pathPrefix match among cloudflare.worker endpoints.
 */
export declare function selectHttpEndpointFromHttpEndpointSet(endpoints: StoredHttpEndpoint[], path: string, method: string): StoredHttpEndpoint | null;
export declare function selectRouteRefFromHttpEndpointSet(endpoints: StoredHttpEndpoint[], path: string, method: string): string | null;
export declare function parseRoutingValue(raw: string | null | undefined): ParsedRoutingValue;
//# sourceMappingURL=resolver.d.ts.map