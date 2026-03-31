/**
 * Deployment service — re-exports from sub-modules for backward compatibility.
 */
export { DeploymentService, buildDeploymentArtifactRef } from './service.ts';
export type { DeploymentEnv } from './service.ts';
export type { DeployState, Deployment, DeploymentEvent, CreateDeploymentInput, RollbackInput } from './models.ts';
export { rollbackDeploymentSteps } from './rollback.ts';
