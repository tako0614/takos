import { and, eq, notInArray } from "drizzle-orm";

import {
  deleteDeploymentSourceArtifacts,
  type DeploymentEnv,
  DeploymentService,
} from "../../application/services/deployment/index.ts";
import {
  registerDeploymentController,
  unregisterDeploymentController,
} from "../../application/services/deployment/cancellation-registry.ts";
import { deployments, getDb } from "../../infra/db/index.ts";
import {
  DEPLOYMENT_QUEUE_MESSAGE_VERSION,
  type DeploymentQueueMessage,
  type WorkerDeploymentQueueMessage,
} from "../../shared/types/index.ts";
import { logError, logInfo } from "../../shared/utils/logger.ts";

export type { DeploymentQueueMessage, WorkerDeploymentQueueMessage };

export function isValidDeploymentQueueMessage(
  msg: unknown,
): msg is DeploymentQueueMessage {
  if (!msg || typeof msg !== "object") return false;
  const m = msg as Record<string, unknown>;
  return m.version === DEPLOYMENT_QUEUE_MESSAGE_VERSION &&
    m.type === "deployment" &&
    typeof m.deploymentId === "string" &&
    typeof m.timestamp === "number";
}

export async function handleDeploymentJob(
  message: DeploymentQueueMessage,
  env: DeploymentEnv,
): Promise<void> {
  const { deploymentId } = message;
  logInfo(`Processing deployment ${deploymentId}`, { module: "deploy_queue" });

  const deploymentService = new DeploymentService(env);

  // Register a controller so a cancel route running in the same isolate can
  // abort the in-flight pipeline. Unregistered in finally regardless of
  // outcome.
  const controller = registerDeploymentController(deploymentId);

  try {
    await deploymentService.executeDeployment(deploymentId, controller.signal);
    logInfo(`Deployment ${deploymentId} completed successfully`, {
      module: "deploy_queue",
    });
  } catch (error) {
    logError(`Deployment ${deploymentId} failed`, error, {
      module: "deploy_queue",
    });
    throw error;
  } finally {
    unregisterDeploymentController(deploymentId);
  }
}

export async function handleDeploymentJobDlq(
  message: DeploymentQueueMessage,
  env: DeploymentEnv,
  attempts: number,
  queueName = "takos-deployment-jobs-dlq",
): Promise<void> {
  const { deploymentId } = message;

  const dlqEntry = {
    level: "CRITICAL",
    event: "DEPLOYMENT_DLQ_ENTRY",
    queue: queueName,
    deploymentId,
    timestamp: new Date().toISOString(),
    retryCount: attempts,
    originalTimestamp: message.timestamp,
  };
  logError(`CRITICAL: ${JSON.stringify(dlqEntry)}`, undefined, {
    module: "deploy_dlq",
  });

  try {
    const deploymentService = new DeploymentService(env);
    const deployment = await deploymentService.getDeploymentById(deploymentId);
    if (
      deployment && deployment.status !== "success" &&
      deployment.status !== "rolled_back"
    ) {
      const db = getDb(env.DB);
      const now = new Date().toISOString();
      await db.update(deployments).set({
        status: "failed",
        deployState: "failed",
        stepError: "DLQ: Deployment failed permanently after max retries",
        cancellationRequestedAt: null,
        updatedAt: now,
      }).where(
        and(
          eq(deployments.id, deploymentId),
          notInArray(deployments.status, ["success", "rolled_back"]),
        ),
      ).run();

      // Terminal failure: the retry/resume path is exhausted, so the source
      // bundle/wasm is now safe to delete (the per-attempt rollback no longer
      // touches it, which is what lets queued retries resume).
      await deleteDeploymentSourceArtifacts(env, deploymentId, deployment);
    }
  } catch (err) {
    logError("Failed to update deployment status", err, {
      module: "deploy_dlq",
    });
    throw err;
  }
}
