import type { DurableObjectNamespace } from '../shared/types/bindings.ts';
export declare function disposeRedisDurableObjectClient(): Promise<void>;
/**
 * Creates a Redis-backed DurableObjectNamespace emulation.
 *
 * Each DO instance is identified by a name (from idFromName).
 * The stub's fetch() stores/retrieves state via Redis HASH operations,
 * delegating to a fetch handler that implements the DO's HTTP interface.
 *
 * @param redisUrl - Redis connection URL
 * @param prefix - Key prefix for this namespace (e.g., 'session', 'git-push-lock')
 * @param fetchHandler - Optional handler to process fetch requests against Redis-backed state.
 *   If not provided, the stub returns a simple JSON response.
 */
export declare function createRedisDurableObjectNamespace(redisUrl: string, prefix: string, fetchHandler?: (instanceId: string, storage: RedisDurableObjectStorage, request: Request) => Promise<Response>): DurableObjectNamespace;
/**
 * Redis-backed storage for a Durable Object instance.
 * Provides get/put/delete/list on a Redis HASH per instance.
 */
export type RedisDurableObjectStorage = {
    get<T = unknown>(key: string): Promise<T | undefined>;
    getMultiple<T = unknown>(keys: string[]): Promise<Map<string, T>>;
    put(key: string, value: unknown): Promise<void>;
    putMultiple(entries: Record<string, unknown>): Promise<void>;
    delete(key: string): Promise<boolean>;
    deleteMultiple(keys: string[]): Promise<number>;
    list<T = unknown>(options?: {
        prefix?: string;
        limit?: number;
    }): Promise<Map<string, T>>;
};
export declare function createRedisDurableObjectStorage(redisUrl: string, prefix: string, instanceId: string): RedisDurableObjectStorage;
//# sourceMappingURL=redis-durable-object.d.ts.map