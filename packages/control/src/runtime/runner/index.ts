// Runner handler module (queue + cron).
// Run dispatch, DLQ, stale run recovery.
// Imported by the unified takos-worker entrypoint (src/runtime/worker/index.ts).
import type { MessageBatch, ScheduledEvent } from '../../shared/types/bindings.ts';
import type { RunnerEnv as Env } from '../../shared/types/index.ts';
import { handleQueue } from './queue-handler.ts';
import { handleScheduled } from './cron-handler.ts';

export { handleQueue };
export { handleScheduled };

export default {
  async queue(batch: MessageBatch<unknown>, env: Env): Promise<void> {
    return handleQueue(batch, env);
  },

  async scheduled(event: ScheduledEvent, env: Env): Promise<void> {
    return handleScheduled(event, env);
  },
};
