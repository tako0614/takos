import type { DurableObjectNamespace, DurableObjectStubBinding } from '../../../shared/types/bindings.ts';
import type { RoutingBindings } from './routing-models';
export declare const ROUTING_DO_SHARD_COUNT = 16;
/**
 * Calculate shard ID from a key (hostname).
 * Uses 32-bit FNV-1a for stable distribution.
 */
export declare function getHostnameShardId(hostname: string, shardCount?: number): string;
export declare function getRoutingDOStub(env: RoutingBindings & {
    ROUTING_DO: DurableObjectNamespace;
}, hostname: string): DurableObjectStubBinding;
//# sourceMappingURL=sharding.d.ts.map