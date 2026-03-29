import type { D1Database } from '../shared/types/bindings.ts';
import type { LocalFetch } from './runtime-types.ts';
type LocalExecutorHostEnv = {
    DB: D1Database;
    EXECUTOR_CONTAINER: unknown;
    OPENAI_API_KEY?: string;
    ANTHROPIC_API_KEY?: string;
    GOOGLE_API_KEY?: string;
    [key: string]: unknown;
};
export declare function buildLocalExecutorHostFetch(env: LocalExecutorHostEnv): Promise<LocalFetch>;
export {};
//# sourceMappingURL=executor-control-rpc.d.ts.map