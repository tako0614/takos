// Worker runtime factory implementation.
// Creates the unified worker runtime with fetch, queue, and scheduled handlers.
import type { MessageBatch, ScheduledEvent } from '../../shared/types/bindings.ts';
import type { WorkerEnv as Env } from './env';
import type { IndexJobQueueMessage } from '../../shared/types';
import { logError } from '../../shared/utils/logger';
import { buildWorkersWorkerPlatform } from '../../platform/adapters/workers.ts';
import type { ControlPlatform } from '../../platform/platform-config.ts';

// Lazy imports to keep cold-start fast — only load what's needed per invocation.

export function createWorkerRuntime(
  buildPlatform: (env: Env) => ControlPlatform<Env> | Promise<ControlPlatform<Env>> = buildWorkersWorkerPlatform,
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
    const { default: egress } = await import('./egress');
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
    const queueName = batch.queue.replace(/-staging$/i, '');

    // --- runner queues ---
    if (
      queueName === 'takos-runs' ||
      queueName === 'takos-runs-dlq'
    ) {
      const { default: runner } = await import('../runner/index');
      return runner.queue(batch, bindings);
    }

    // --- indexer queues ---
    if (queueName === 'takos-index-jobs') {
      const { default: indexer } = await import('../indexer/index');
      return indexer.queue(batch as MessageBatch<IndexJobQueueMessage>, bindings);
    }

    if (queueName === 'takos-index-jobs-dlq') {
      const { handleIndexJobDlq } = await import('../indexer/index');
      for (const message of batch.messages) {
        try {
          await handleIndexJobDlq(message.body, bindings, message.attempts);
          message.ack();
        } catch (err) {
          logError('Handler failed', err, { module: 'index_dlq' });
          message.ack();
        }
      }
      return;
    }

    // --- workflow / deployment queues ---
    if (
      queueName === 'takos-workflow-jobs' ||
      queueName === 'takos-workflow-jobs-dlq' ||
      queueName === 'takos-deployment-jobs' ||
      queueName === 'takos-deployment-jobs-dlq'
    ) {
      const { default: workflowRunner } = await import('../queues/workflow-runner');
      return workflowRunner.queue(batch, bindings);
    }

    logError(`Unknown queue: ${batch.queue}`, undefined, { module: 'worker_queue' });
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
    const { default: runner } = await import('../runner/index');
    return runner.scheduled(event, bindings);
  },
  };
}
