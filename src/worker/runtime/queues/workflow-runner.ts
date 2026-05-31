// Workflow/deployment handler module (queue).
// Workflow + deployment job queue wiring.
// Imported by the unified takos-worker entrypoint (src/runtime/worker/index.ts).
import type { MessageQueueBatch } from "../../shared/types/bindings.ts";

import {
  createWorkflowQueueConsumer,
  handleWorkflowJobDlq,
  type WorkflowQueueEnv,
} from "./workflow-jobs.ts";
import {
  type DeploymentQueueMessage,
  handleDeploymentJob,
  handleDeploymentJobDlq,
  isValidDeploymentQueueMessage,
} from "./deploy-jobs.ts";
import type { DeploymentEnv } from "../../application/services/deployment/index.ts";
import {
  createEnvGuard,
  validateWorkflowRunnerEnv,
} from "../../shared/utils/validate-env.ts";
import { logError, logWarn } from "../../shared/utils/logger.ts";
import { classifyWorkerQueueName } from "./queue-names.ts";

// Cached environment validation guard for the workflow path only; the
// deployment path uses `isDeploymentEnv` below as a type predicate so the
// narrowed env is usable without a cast.
const workflowEnvGuard = createEnvGuard(validateWorkflowRunnerEnv);

type WorkflowRunnerEnv = WorkflowQueueEnv & Partial<DeploymentEnv>;

/**
 * Type predicate confirming the worker queue env carries every binding the
 * deployment job code path consumes. When true, TypeScript narrows the env
 * to a full `DeploymentEnv` so downstream calls do not need a cast. The
 * guarded fields are the required-in-`Env` bindings that are not already
 * required by `WorkflowQueueEnv` (DB and RUN_NOTIFIER are required by
 * `WorkflowQueueEnv` itself).
 */
function isDeploymentEnv(
  env: WorkflowRunnerEnv,
): env is WorkflowRunnerEnv & DeploymentEnv {
  return Boolean(
    env.RUN_QUEUE &&
      env.ADMIN_DOMAIN &&
      env.TENANT_BASE_DOMAIN &&
      env.HOSTNAME_ROUTING &&
      env.ENCRYPTION_KEY,
  );
}

function reportDeploymentEnvMissing(): void {
  logError(
    "Environment validation failed: deployment queue is missing required " +
      "bindings (need DB, ENCRYPTION_KEY, HOSTNAME_ROUTING, RUN_QUEUE, " +
      "ADMIN_DOMAIN, TENANT_BASE_DOMAIN)",
    undefined,
    { module: "startup" },
  );
}

export default {
  async queue(
    batch: MessageQueueBatch<unknown>,
    env: WorkflowRunnerEnv,
  ): Promise<void> {
    const queueKind = classifyWorkerQueueName(batch.queue);
    if (
      queueKind === "deployment_jobs" || queueKind === "deployment_jobs_dlq"
    ) {
      if (!isDeploymentEnv(env)) {
        reportDeploymentEnvMissing();
        for (const message of batch.messages) {
          message.retry();
        }
        return;
      }
      if (queueKind === "deployment_jobs") {
        for (const message of batch.messages) {
          const body = message.body;
          if (!isValidDeploymentQueueMessage(body)) {
            logError(
              "Invalid message format",
              JSON.stringify(body).slice(0, 200),
              { module: "deploy_queue" },
            );
            message.ack();
            continue;
          }
          try {
            await handleDeploymentJob(body, env);
            message.ack();
          } catch (err) {
            const jobId = body.deploymentId;
            logError(`Job failed for deployment queue item ${jobId}`, err, {
              module: "deploy_queue",
            });
            message.retry();
          }
        }
        return;
      }
      // deployment_jobs_dlq
      for (const message of batch.messages) {
        try {
          await handleDeploymentJobDlq(
            message.body as DeploymentQueueMessage,
            env,
            message.attempts,
            batch.queue,
          );
          message.ack();
        } catch (err) {
          logError(`Handler failed`, err, { module: "deploy_dlq" });
          message.retry();
        }
      }
      return;
    }

    const envError = queueKind === "workflow_jobs" ||
        queueKind === "workflow_jobs_dlq"
      ? workflowEnvGuard(env)
      : null;
    if (envError) {
      for (const message of batch.messages) {
        message.retry();
      }
      return;
    }

    if (queueKind === "workflow_jobs") {
      const consumer = createWorkflowQueueConsumer(env);
      // MessageQueueBatch<unknown> is structurally compatible with the consumer's
      // expected batch shape ({ messages: ReadonlyArray<{ body: unknown; ack; retry }> }).
      await consumer.queue(batch);
      return;
    }

    if (queueKind === "workflow_jobs_dlq") {
      for (const message of batch.messages) {
        try {
          await handleWorkflowJobDlq(
            message.body,
            env,
            message.attempts,
            batch.queue,
          );
          message.ack();
        } catch (err) {
          logError("Handler failed", err, { module: "workflow_dlq" });
          message.retry();
        }
      }
      return;
    }

    logWarn(`Unknown queue: ${batch.queue}`, { module: "workflow_queue" });
    for (const message of batch.messages) {
      message.ack();
    }
  },
};
