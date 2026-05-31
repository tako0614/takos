// ---------------------------------------------------------------------------
// Public workflow queue entrypoint backed by focused sub-modules.
//
// Queue consumers import the public API from this module.
// ---------------------------------------------------------------------------

import { isValidWorkflowJobQueueMessage } from "../../shared/types/index.ts";
import { logError } from "../../shared/utils/logger.ts";
import type { QueueBatchMessage } from "./workflow-types.ts";
import { handleWorkflowJob } from "./workflow-job-handler.ts";

// Public API used by queue consumers.
export type { WorkflowQueueEnv } from "./workflow-types.ts";
export { handleWorkflowJob } from "./workflow-job-handler.ts";
export { handleWorkflowJobDlq } from "./workflow-dlq.ts";

// ---------------------------------------------------------------------------
// message queue consumer
// ---------------------------------------------------------------------------

export function createWorkflowQueueConsumer(
  env: import("./workflow-types.ts").WorkflowQueueEnv,
) {
  return {
    async queue(batch: { messages: ReadonlyArray<QueueBatchMessage> }) {
      for (const message of batch.messages) {
        const body = message.body;

        if (!isValidWorkflowJobQueueMessage(body)) {
          logError("Invalid workflow job message format, skipping", undefined, {
            module: "workflow_queue",
          });
          message.ack();
          continue;
        }

        try {
          await handleWorkflowJob(body, env);
          message.ack();
        } catch (err) {
          logError("Workflow job failed", err, {
            module: "queues/workflow-jobs",
          });
          message.retry();
        }
      }
    },
  };
}
