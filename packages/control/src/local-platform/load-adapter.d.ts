import type { Env } from '../shared/types/index.ts';
import type { DispatchEnv } from '../dispatch.ts';
export interface LocalControlAdapterModule {
    createNodeWebEnv?: () => Promise<Env> | Env;
    createNodeDispatchEnv?: () => Promise<DispatchEnv> | DispatchEnv;
}
export declare function loadLocalWebEnv(): Promise<Env>;
export declare function loadLocalDispatchEnv(): Promise<DispatchEnv>;
//# sourceMappingURL=load-adapter.d.ts.map