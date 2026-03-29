import type { MessageBatch, ScheduledEvent } from '../../shared/types/bindings.ts';
import type { RunnerEnv as Env } from '../../shared/types';
import { handleQueue } from './queue-handler';
import { handleScheduled } from './cron-handler';
export { handleQueue };
export { handleScheduled };
declare const _default: {
    queue(batch: MessageBatch<unknown>, env: Env): Promise<void>;
    scheduled(event: ScheduledEvent, env: Env): Promise<void>;
};
export default _default;
//# sourceMappingURL=index.d.ts.map