import type { SqlDatabaseBinding } from '../../../shared/types/bindings.ts';
import type { DeployState, DeploymentStatus, Deployment } from './types';
import { logDeploymentEvent, updateDeploymentRecord, getStuckDeployments } from './store';

export async function updateDeploymentState(
  db: SqlDatabaseBinding,
  deploymentId: string,
  status: DeploymentStatus,
  state: DeployState
): Promise<void> {
  const now = new Date().toISOString();
  await updateDeploymentRecord(db, deploymentId, {
    status,
    deployState: state,
    updatedAt: now,
  });
}

// Records step start, executes action, then records completion or failure.
// If the action crashes mid-step, the updatedAt timestamp allows the
// stuck-deployment detector to identify and reset stale deployments.
export async function executeDeploymentStep(
  db: SqlDatabaseBinding,
  deploymentId: string,
  state: DeployState,
  stepName: string,
  action: () => Promise<void>
): Promise<void> {
  const now = new Date().toISOString();

  await updateDeploymentRecord(db, deploymentId, {
    deployState: state,
    currentStep: stepName,
    stepError: null,
    updatedAt: now,
  });

  await logDeploymentEvent(db, deploymentId, 'step_started', stepName, `Starting step: ${stepName}`);

  try {
    await action();

    const completedAt = new Date().toISOString();
    await updateDeploymentRecord(db, deploymentId, {
      currentStep: stepName,
      stepError: null,
      updatedAt: completedAt,
    });
    await logDeploymentEvent(db, deploymentId, 'step_completed', stepName, `Completed step: ${stepName}`);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const failedAt = new Date().toISOString();
    await updateDeploymentRecord(db, deploymentId, {
      stepError: errorMessage,
      updatedAt: failedAt,
    });
    await logDeploymentEvent(db, deploymentId, 'step_failed', stepName, errorMessage);
    throw error;
  }
}

const DEFAULT_STUCK_TIMEOUT_MS = 10 * 60 * 1000;

export async function detectStuckDeployments(
  db: SqlDatabaseBinding,
  timeoutMs: number = DEFAULT_STUCK_TIMEOUT_MS
): Promise<Deployment[]> {
  const cutoff = new Date(Date.now() - timeoutMs).toISOString();
  return getStuckDeployments(db, cutoff);
}

export async function resetStuckDeployment(
  db: SqlDatabaseBinding,
  deploymentId: string,
  reason: string = 'Deployment timed out and was marked as failed by stuck-detector'
): Promise<void> {
  const now = new Date().toISOString();
  await updateDeploymentRecord(db, deploymentId, {
    status: 'failed',
    deployState: 'failed',
    stepError: reason,
    updatedAt: now,
  });
  await logDeploymentEvent(db, deploymentId, 'stuck_reset', null, reason);
}
