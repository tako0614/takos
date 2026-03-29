import type { Deployment, DeploymentEnv } from './models';
/**
 * Execute a deployment through all pipeline steps (deploy_worker, update_routing, finalize).
 *
 * This is the core orchestration extracted from DeploymentService.executeDeployment.
 */
export declare function executeDeploymentPipeline(env: DeploymentEnv, encryptionKey: string, deploymentId: string): Promise<Deployment>;
//# sourceMappingURL=execute.d.ts.map