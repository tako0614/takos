import type { Deployment, DeploymentEnv, RollbackInput } from './models';
/**
 * Execute a rollback to a previous deployment version.
 *
 * Validates rollback target, re-deploys container artifacts when needed,
 * switches routing pointers, and updates all DB records.
 */
export declare function executeRollback(env: DeploymentEnv, input: RollbackInput): Promise<Deployment>;
//# sourceMappingURL=rollback-orchestrator.d.ts.map