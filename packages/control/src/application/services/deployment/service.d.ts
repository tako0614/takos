/**
 * Core deployment service — CRUD and lifecycle management.
 *
 * Provides the DeploymentService class that coordinates deployment creation,
 * execution, rollback, and query operations by delegating to the executor,
 * rollback, artifact, and helper sub-modules.
 */
import type { WorkerBinding } from '../../../platform/providers/cloudflare/wfp.ts';
import type { Deployment, DeploymentEvent, DeploymentEnv, CreateDeploymentInput, RollbackInput } from './models';
export { buildDeploymentArtifactRef } from './artifact-refs';
export type { DeploymentEnv } from './models';
export declare class DeploymentService {
    private env;
    private encryptionKey;
    constructor(env: DeploymentEnv, encryptionKey?: string);
    createDeployment(input: CreateDeploymentInput): Promise<Deployment>;
    executeDeployment(deploymentId: string): Promise<Deployment>;
    rollback(input: RollbackInput): Promise<Deployment>;
    rollbackWorker(workerId: string, userId: string, targetVersion?: number): Promise<Deployment>;
    resumeDeployment(deploymentId: string): Promise<Deployment>;
    getDeploymentById(deploymentId: string): Promise<Deployment | null>;
    getDeploymentHistory(serviceId: string, limit?: number): Promise<Deployment[]>;
    getDeploymentEvents(deploymentId: string): Promise<DeploymentEvent[]>;
    getEnvVars(deployment: Deployment): Promise<Record<string, string>>;
    getMaskedEnvVars(deployment: Deployment): Promise<Record<string, string>>;
    getBindings(deployment: Deployment): Promise<WorkerBinding[]>;
    /**
     * Detect and reset stuck deployments.
     *
     * Finds deployments that have been in "in_progress" status for longer than
     * timeoutMs (default: 10 minutes) and marks them as failed so they can be
     * retried via resumeDeployment().
     *
     * Returns the number of deployments that were reset.
     */
    cleanupStuckDeployments(timeoutMs?: number): Promise<number>;
}
//# sourceMappingURL=service.d.ts.map