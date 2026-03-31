import { DeploymentService, type DeploymentEnv } from '../../application/services/deployment/index.ts';
import { getDb, deployments } from '../../infra/db/index.ts';
import { eq, and, notInArray } from 'drizzle-orm';
import { logError, logInfo } from '../../shared/utils/logger.ts';

// ---------------------------------------------------------------------------
// Message types
// ---------------------------------------------------------------------------

export interface DeploymentQueueMessage {
  version: number;
  type: 'deployment';
  deploymentId: string;
  timestamp: number;
}

export function isValidDeploymentQueueMessage(msg: unknown): msg is DeploymentQueueMessage {
  if (!msg || typeof msg !== 'object') return false;
  const m = msg as Record<string, unknown>;
  return (
    m.version === 1 &&
    m.type === 'deployment' &&
    typeof m.deploymentId === 'string' &&
    typeof m.timestamp === 'number'
  );
}

// ---------------------------------------------------------------------------
// Main job handler
// ---------------------------------------------------------------------------

export async function handleDeploymentJob(
  message: DeploymentQueueMessage,
  env: DeploymentEnv,
): Promise<void> {
  const { deploymentId } = message;
  logInfo(`Processing deployment ${deploymentId}`, { module: 'deploy_queue' });

  const deploymentService = new DeploymentService(env);

  try {
    await deploymentService.executeDeployment(deploymentId);
    logInfo(`Deployment ${deploymentId} completed successfully`, { module: 'deploy_queue' });
  } catch (error) {
    logError(`Deployment ${deploymentId} failed`, error, { module: 'deploy_queue' });
    throw error; // Let the queue retry mechanism handle it
  }
}

// ---------------------------------------------------------------------------
// DLQ handler
// ---------------------------------------------------------------------------

export async function handleDeploymentJobDlq(
  message: DeploymentQueueMessage,
  env: DeploymentEnv,
  attempts: number,
): Promise<void> {
  const { deploymentId } = message;

  const dlqEntry = {
    level: 'CRITICAL',
    event: 'DEPLOYMENT_DLQ_ENTRY',
    deploymentId,
    timestamp: new Date().toISOString(),
    retryCount: attempts,
    originalTimestamp: message.timestamp,
  };
  logError(`CRITICAL: ${JSON.stringify(dlqEntry)}`, undefined, { module: 'deploy_dlq' });

  // Mark deployment as failed if still in progress
  try {
    const deploymentService = new DeploymentService(env);
    const deployment = await deploymentService.getDeploymentById(deploymentId);
    if (deployment && deployment.status !== 'success' && deployment.status !== 'rolled_back') {
      const db = getDb(env.DB);
      const now = new Date().toISOString();
      await db.update(deployments).set({
        status: 'failed',
        deployState: 'failed',
        stepError: `DLQ: Deployment failed permanently after max retries`,
        updatedAt: now,
      }).where(and(eq(deployments.id, deploymentId), notInArray(deployments.status, ['success', 'rolled_back'])));
    }
  } catch (err) {
    logError(`Failed to update deployment status`, err, { module: 'deploy_dlq' });
    throw err;
  }
}
