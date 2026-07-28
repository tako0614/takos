// Workflow handler module (queue).
// Imported by the unified takos-worker entrypoint (src/runtime/worker/index.ts).
import type { MessageQueueBatch } from "../../shared/types/bindings.ts";

import {
  createWorkflowQueueConsumer,
  handleWorkflowJobDlq,
  type WorkflowQueueEnv,
} from "./workflow-jobs.ts";
import {
  createEnvGuard,
  validateWorkflowRunnerEnv,
} from "../../shared/utils/validate-env.ts";
import { logError, logWarn } from "../../shared/utils/logger.ts";
import { classifyWorkerQueueName } from "./queue-names.ts";

const workflowEnvGuard = createEnvGuard(validateWorkflowRunnerEnv);

type WorkflowRunnerEnv = WorkflowQueueEnv;

export default {
  async queue(
    batch: MessageQueueBatch<unknown>,
    env: WorkflowRunnerEnv,
  ): Promise<void> {
    const queueKind = classifyWorkerQueueName(batch.queue);
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
