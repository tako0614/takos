/**
 * Deployment service — re-exports from sub-modules for backward compatibility.
 */
export { DeploymentService, createDeploymentService, buildDeploymentArtifactRef } from './service';
export type { DeploymentEnv } from './service';
export type { DeployState, Deployment, DeploymentEvent, CreateDeploymentInput, RollbackInput } from './types';
export { rollbackDeploymentSteps } from './rollback';

// Multi-agent exports
export { DeploymentExecutorAgent, type DeploymentInput as DeploymentAgentInput, type DeploymentOutput as DeploymentAgentOutput } from './executor-agent';
