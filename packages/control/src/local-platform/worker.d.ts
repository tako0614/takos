import type { WorkerEnv } from '../runtime/worker/env.ts';
import { type ConsumableQueue } from './queue-runtime.ts';
export declare function resolveWorkerHeartbeatTtlMs(): number;
export declare function runLocalWorkerIteration(env: WorkerEnv, queues?: ConsumableQueue<unknown>[]): Promise<boolean>;
export declare function createLocalWorkerEnv(): Promise<WorkerEnv>;
export declare function startLocalWorkerLoop(): Promise<void>;
//# sourceMappingURL=worker.d.ts.map