import type { SqlDatabaseBinding } from '../../../shared/types/bindings.ts';
import type { DeployState, DeploymentStatus, Deployment } from './models';
export declare function updateDeploymentState(db: SqlDatabaseBinding, deploymentId: string, status: DeploymentStatus, state: DeployState): Promise<void>;
export declare function executeDeploymentStep(db: SqlDatabaseBinding, deploymentId: string, state: DeployState, stepName: string, action: () => Promise<void>): Promise<void>;
export declare function detectStuckDeployments(db: SqlDatabaseBinding, timeoutMs?: number): Promise<Deployment[]>;
export declare function resetStuckDeployment(db: SqlDatabaseBinding, deploymentId: string, reason?: string): Promise<void>;
//# sourceMappingURL=state.d.ts.map