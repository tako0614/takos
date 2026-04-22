// Worker runtime factory implementation.
// Creates the unified worker runtime with fetch, queue, and scheduled handlers.
import type {
  MessageBatch,
  ScheduledEvent,
} from "../../shared/types/bindings.ts";
import type { WorkerEnv as Env } from "./env.ts";
import type { IndexJobQueueMessage } from "../../shared/types/index.ts";
import { logError } from "../../shared/utils/logger.ts";
import { buildWorkersWorkerPlatform } from "../../platform/adapters/workers.ts";
import type { ControlPlatform } from "../../platform/platform-config.ts";
import { classifyWorkerQueueName } from "../queues/queue-names.ts";

// Lazy imports to keep cold-start fast — only load what's needed per invocation.

export function createWorkerRuntime(
  buildPlatform: (
    env: Env,
  ) => ControlPlatform<Env> | Promise<ControlPlatform<Env>> =
    buildWorkersWorkerPlatform,
) {
  return {
    // ---------------------------------------------------------------------------
    // fetch: egress proxy (service-binding only, no public routes)
    // ---------------------------------------------------------------------------
    async fetch(request: Request, env: Env): Promise<Response> {
      const platform = await buildPlatform(env);
      const runtimeBindings = {
        ...platform.bindings,
        PLATFORM: platform,
      } as Env & {
        PLATFORM?: ControlPlatform<Env>;
      };
      const { default: egress } = await import("./egress.ts");
      return egress.fetch(request, runtimeBindings);
    },

    // ---------------------------------------------------------------------------
    // queue: unified dispatcher
    // ---------------------------------------------------------------------------
    async queue(batch: MessageBatch<unknown>, env: Env): Promise<void> {
      const platform = await buildPlatform(env);
      const bindings = {
        ...platform.bindings,
        PLATFORM: platform,
      } as Env & {
        PLATFORM?: ControlPlatform<Env>;
      };
      const queueKind = classifyWorkerQueueName(batch.queue);

      // --- runner queues ---
      if (
        queueKind === "runs" ||
        queueKind === "runs_dlq"
      ) {
        const { default: runner } = await import("../runner/index.ts");
        return runner.queue(batch, bindings);
      }

      // --- indexer queues ---
      if (queueKind === "index_jobs") {
        const { default: indexer } = await import("../indexer/index.ts");
        return indexer.queue(
          batch as MessageBatch<IndexJobQueueMessage>,
          bindings,
        );
      }

      if (queueKind === "index_jobs_dlq") {
        const { handleIndexJobDlq } = await import("../indexer/index.ts");
        for (const message of batch.messages) {
          try {
            await handleIndexJobDlq(
              message.body,
              bindings,
              message.attempts,
              batch.queue,
            );
            message.ack();
          } catch (err) {
            logError("Handler failed", err, { module: "index_dlq" });
            message.retry();
          }
        }
        return;
      }

      // --- workflow / deployment queues ---
      if (
        queueKind === "workflow_jobs" ||
        queueKind === "workflow_jobs_dlq" ||
        queueKind === "deployment_jobs" ||
        queueKind === "deployment_jobs_dlq"
      ) {
        const { default: workflowRunner } = await import(
          "../queues/workflow-runner.ts"
        );
        return workflowRunner.queue(batch, bindings);
      }

      logError(`Unknown queue: ${batch.queue}`, undefined, {
        module: "worker_queue",
      });
      for (const message of batch.messages) {
        message.retry();
      }
    },

    // ---------------------------------------------------------------------------
    // scheduled: stale run recovery (from runner)
    // ---------------------------------------------------------------------------
    async scheduled(event: ScheduledEvent, env: Env): Promise<void> {
      const platform = await buildPlatform(env);
      const bindings = {
        ...platform.bindings,
        PLATFORM: platform,
      } as Env & {
        PLATFORM?: ControlPlatform<Env>;
      };
      const { default: runner } = await import("../runner/index.ts");
      return runner.scheduled(event, bindings);
    },
  };
}
