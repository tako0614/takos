// Workflow/deployment handler module (queue).
// Workflow + deployment job queue wiring.
// Imported by the unified takos-worker entrypoint (src/runtime/worker/index.ts).
import type { MessageBatch } from "../../shared/types/bindings.ts";

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
  validateDeploymentQueueEnv,
  validateWorkflowRunnerEnv,
} from "../../shared/utils/validate-env.ts";
import { logError, logWarn } from "../../shared/utils/logger.ts";
import { classifyWorkerQueueName } from "./queue-names.ts";

// Cached environment validation guards.
const workflowEnvGuard = createEnvGuard(validateWorkflowRunnerEnv);
const deploymentEnvGuard = createEnvGuard(validateDeploymentQueueEnv);

type WorkflowRunnerEnv = WorkflowQueueEnv & DeploymentEnv;

export default {
  async queue(
    batch: MessageBatch<unknown>,
    env: WorkflowRunnerEnv,
  ): Promise<void> {
    const queueKind = classifyWorkerQueueName(batch.queue);
    const envError = queueKind === "deployment_jobs" ||
        queueKind === "deployment_jobs_dlq"
      ? deploymentEnvGuard(env)
      : queueKind === "workflow_jobs" ||
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
      // MessageBatch<unknown> is structurally compatible with the consumer's
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
          const jobId = body.type === "deployment"
            ? body.deploymentId
            : body.groupId;
          logError(`Job failed for deployment queue item ${jobId}`, err, {
            module: "deploy_queue",
          });
          message.retry();
        }
      }
      return;
    }

    if (queueKind === "deployment_jobs_dlq") {
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

    logWarn(`Unknown queue: ${batch.queue}`, { module: "workflow_queue" });
    for (const message of batch.messages) {
      message.ack();
    }
  },
};
