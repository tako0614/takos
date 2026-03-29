import type { Env } from '../../shared/types/index.ts';
import type { WorkerEnv } from '../../runtime/worker/env.ts';
import type { DispatchEnv } from '../../dispatch.ts';
import type { ControlPlatform } from '../platform-config.ts';
export declare function buildNodeWebPlatform(env: Env): Promise<ControlPlatform<Env>>;
export declare function buildNodeDispatchPlatform(env: DispatchEnv): Promise<ControlPlatform<DispatchEnv>>;
export declare function buildNodeWorkerPlatform(env: WorkerEnv): Promise<ControlPlatform<WorkerEnv>>;
//# sourceMappingURL=node.d.ts.map