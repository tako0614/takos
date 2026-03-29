import type { DbEnv } from '../../../shared/types';
import type { RoutingBindings, RoutingTarget } from '../routing/routing-models';
import { type DeploymentRoutingServiceRecord } from './store';
import type { DeploymentTarget } from './models';
type DeploymentRoutingEnv = DbEnv & RoutingBindings;
export type RoutingSnapshot = Array<{
    hostname: string;
    target: RoutingTarget | null;
}>;
type ActiveDeploymentInfo = {
    id: string;
    artifactRef: string | null;
    targetJson: string;
    routingStatus: string;
};
type RoutingContext = {
    deploymentId: string;
    deploymentVersion: number;
    deployArtifactRef: string;
    deploymentTarget: DeploymentTarget;
    serviceRouteRecord: DeploymentRoutingServiceRecord;
    desiredRoutingStatus: string;
    desiredRoutingWeight: number;
    activeDeployment: ActiveDeploymentInfo | null;
};
type RoutingPlan = {
    target: RoutingTarget;
    auditDetails: Record<string, unknown>;
};
export declare function collectHostnames(serviceRouteRecord: {
    hostname: string | null;
    customDomains: Array<{
        domain: string | null;
    }>;
}): string[];
export declare function snapshotRouting(env: DeploymentRoutingEnv, hostnameList: string[]): Promise<RoutingSnapshot>;
export declare function restoreRoutingSnapshot(env: DeploymentRoutingEnv, snapshot: RoutingSnapshot): Promise<void>;
export declare function buildRoutingTarget(ctx: RoutingContext, hostnameList: string[]): RoutingPlan;
export declare function applyRoutingDbUpdates(env: DeploymentRoutingEnv, ctx: RoutingContext, nowIso: string): Promise<void>;
export declare function applyRoutingToHostnames(env: DeploymentRoutingEnv, hostnameList: string[], target: RoutingTarget): Promise<void>;
export declare function fetchServiceWithDomains(env: DeploymentRoutingEnv, serviceId: string): Promise<DeploymentRoutingServiceRecord | null>;
export {};
//# sourceMappingURL=routing.d.ts.map