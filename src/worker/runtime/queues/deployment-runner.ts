import type { MessageQueueBatch } from "../../shared/types/bindings.ts";
import { classifyWorkerQueueName } from "./queue-names.ts";
import { logWarn } from "../../shared/utils/logger.ts";

/**
 * Drain queue messages left by deployments that predate the Takosumi-owned
 * Capsule Run boundary. This compatibility tombstone deliberately has no
 * database or deployment-service dependency: acknowledging is the only safe
 * local action once Takos stops owning deployment lifecycle state.
 */
export default {
  async queue(batch: MessageQueueBatch<unknown>): Promise<void> {
    const queueKind = classifyWorkerQueueName(batch.queue);
    if (
      queueKind !== "deployment_jobs" &&
      queueKind !== "deployment_jobs_dlq"
    ) {
      throw new Error(`Unexpected retired deployment queue: ${batch.queue}`);
    }

    logWarn("Acknowledging retired product-local deployment queue batch", {
      module: "deployment_queue",
      queue: batch.queue,
      queueKind,
      messageCount: batch.messages.length,
      lifecycleOwner: "takosumi",
    });
    for (const message of batch.messages) message.ack();
  },
};
