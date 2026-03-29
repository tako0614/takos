/**
 * Pure helper / utility functions for the deployment service.
 *
 * These are stateless functions extracted from service.ts to reduce file size
 * and improve testability.
 */
import type { WorkerBinding } from '../../../platform/providers/cloudflare/wfp.ts';
import type { ServiceRuntimeConfigState } from '../platform/worker-desired-state';
import type { ArtifactKind, Deployment, CreateDeploymentInput, DeploymentTarget } from './models';
export declare function resolveDeploymentArtifactBaseRef(serviceId: string, target?: DeploymentTarget): string;
export declare function buildDeploymentArtifactRef(baseRef: string, version: number): string;
export declare function resolveDeploymentArtifactRef(options: {
    serviceId: string;
    version: number;
    target?: DeploymentTarget;
    persistedArtifactRef?: string | null;
}): string;
export declare function resolveDeploymentServiceId(input: {
    workerId?: string | null;
    serviceId?: string | null;
}): string;
export declare function extractErrorMessage(error: unknown): string;
export declare function parseRuntimeConfig(raw: string | null | undefined): ServiceRuntimeConfigState;
export declare function snapshotFromOverride(override: NonNullable<CreateDeploymentInput['snapshotOverride']>): {
    envVars: Record<string, string>;
    bindings: WorkerBinding[];
    runtimeConfig: ServiceRuntimeConfigState;
};
export declare function assertMatchingIdempotentRequest(deployment: Deployment, expected: {
    artifactKind: ArtifactKind;
    bundleHash: string | null;
    bundleSize: number | null;
    imageRef?: string;
    strategy: 'direct' | 'canary';
    canaryWeight?: number;
}): void;
//# sourceMappingURL=artifact-refs.d.ts.map