import type { DbEnv } from '../../../shared/types';
import type { RoutingBindings } from '../routing/routing-models';
import type { ObjectStoreBinding } from '../../../shared/types/bindings.ts';
import { type RoutingSnapshot } from './routing';
import type { Deployment } from './models';
import type { DeploymentProvider } from './provider';
type RollbackEnv = DbEnv & RoutingBindings & {
    WORKER_BUNDLES?: ObjectStoreBinding;
};
type RollbackContext = {
    env: RollbackEnv;
    deploymentId: string;
    deployment: Deployment;
    completedStepNames: string[];
    routingRollbackSnapshot: RoutingSnapshot | null;
    workerHostname: string | null;
    deploymentArtifactRef: string | null;
    provider: DeploymentProvider;
};
export declare function rollbackDeploymentSteps(ctx: RollbackContext): Promise<void>;
export {};
//# sourceMappingURL=rollback.d.ts.map