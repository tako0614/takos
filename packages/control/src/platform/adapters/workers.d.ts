import type { Env } from '../../shared/types/index.ts';
import type { WorkerEnv } from '../../runtime/worker/env.ts';
import type { DispatchEnv } from '../../dispatch.ts';
import type { ControlPlatform } from '../platform-config.ts';
export declare function buildWorkersWebPlatform(env: Env): ControlPlatform<Env>;
export declare function buildWorkersDispatchPlatform(env: DispatchEnv): ControlPlatform<DispatchEnv>;
export declare function buildWorkersWorkerPlatform(env: WorkerEnv): ControlPlatform<WorkerEnv>;
//# sourceMappingURL=workers.d.ts.map