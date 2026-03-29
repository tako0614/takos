import type { IndexJobQueueMessage } from '../../shared/types';
import type { D1Database } from '../../shared/types/bindings.ts';
import type { IndexerEnv as Env } from '../../shared/types';
export declare function handleVectorize(env: Env, jobId: string, spaceId: string, targetId?: string): Promise<void>;
export declare function handleInfoUnit(env: Env, jobId: string, spaceId: string, targetId?: string): Promise<void>;
export declare function handleThreadContext(env: Env, jobId: string, spaceId: string, targetId?: string): Promise<void>;
export declare function handleRepoCodeIndex(env: Env, jobId: string, body: IndexJobQueueMessage, targetId?: string): Promise<void>;
export declare function handleIndexJobDlq(body: unknown, env: {
    DB: D1Database;
}, attempts?: number): Promise<void>;
//# sourceMappingURL=handlers.d.ts.map