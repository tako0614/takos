import type { MessageBatch, ScheduledEvent } from '../../shared/types/bindings.ts';
import type { WorkerEnv as Env } from './env';
import type { ControlPlatform } from '../../platform/platform-config.ts';
export declare function createWorkerRuntime(buildPlatform?: (env: Env) => ControlPlatform<Env> | Promise<ControlPlatform<Env>>): {
    fetch(request: Request, env: Env): Promise<Response>;
    queue(batch: MessageBatch<unknown>, env: Env): Promise<void>;
    scheduled(event: ScheduledEvent, env: Env): Promise<void>;
};
//# sourceMappingURL=runtime-factory.d.ts.map