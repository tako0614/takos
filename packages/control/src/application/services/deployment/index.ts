/**
 * Deployment service — re-exports from sub-modules for backward compatibility.
 */
export { buildDeploymentArtifactRef, DeploymentService } from "./service.ts";
export type { DeploymentEnv } from "./service.ts";
export type {
  CreateDeploymentInput,
  Deployment,
  DeploymentEvent,
  DeployState,
  RollbackInput,
} from "./models.ts";
export { rollbackDeploymentSteps } from "./rollback.ts";
