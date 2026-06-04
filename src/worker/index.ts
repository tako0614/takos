import type {
  MessageQueueBatch,
  PlatformExecutionContext,
  PlatformScheduledEvent,
  PlatformScheduledController,
} from "./shared/types/bindings.ts";
import { createWebWorker } from "./web.ts";
import { createWorkerRuntime } from "./runtime/worker/runtime-factory.ts";

export {
  NotificationNotifierDO,
  RateLimiterDO,
  RoutingDO,
  RunNotifierDO,
  SessionDO,
} from "./web.ts";
export { TakosRuntimeContainer } from "./runtime/container-hosts/runtime-host.ts";
export {
  ExecutorContainerTier1,
  ExecutorContainerTier2,
  ExecutorContainerTier3,
  TakosAgentExecutorContainer,
} from "./runtime/container-hosts/executor-host.ts";
// Deploy-control Durable Objects, backing the in-process Takosumi deploy-control
// plane (coordination leases/alarms + the OpenTofu Container runner). The
// wrangler `[[durable_objects.bindings]]` class_name + migration
// new_sqlite_classes values must match these exported names.
export {
  TakosCoordinationObject,
  TakosumiOpenTofuRunner,
} from "@takosjp/takosumi-deploy-worker";

export function createTakosWorker() {
  const web = createWebWorker();
  const background = createWorkerRuntime();

  return {
    fetch(
      request: Request,
      env: Parameters<typeof web.fetch>[1] & Parameters<typeof background.fetch>[1],
      ctx: PlatformExecutionContext,
    ): Promise<Response> {
      return web.fetch(request, env, ctx);
    },

    async queue(
      batch: MessageQueueBatch<unknown>,
      env: Parameters<typeof background.queue>[1],
      ctx: PlatformExecutionContext,
    ): Promise<void> {
      await background.queue(batch, env, ctx);
    },

    async scheduled(
      controller: PlatformScheduledEvent & PlatformScheduledController,
      env: Parameters<typeof web.scheduled>[1] & Parameters<typeof background.scheduled>[1],
      ctx: PlatformExecutionContext,
    ): Promise<void> {
      await web.scheduled(controller, env, ctx);
      await background.scheduled(controller, env, ctx);
    },
  };
}

export default createTakosWorker();
