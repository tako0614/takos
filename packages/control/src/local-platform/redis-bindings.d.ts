import type { RoutingStore } from '../application/services/routing/routing-models.ts';
import type { QueueBinding } from '../shared/types/bindings.ts';
export declare function disposeRedisClient(): Promise<void>;
export declare function resetRedisClientForTests(): void;
export declare function createRedisQueue<T = unknown>(redisUrl: string, queueName: string): QueueBinding<T>;
export declare function createRedisRoutingStore(redisUrl: string): RoutingStore;
//# sourceMappingURL=redis-bindings.d.ts.map