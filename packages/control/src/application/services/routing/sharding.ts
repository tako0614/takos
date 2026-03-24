import type {
  DurableObjectNamespace,
  DurableObjectStubBinding,
} from '../../../shared/types/bindings.ts';
import type { RoutingBindings } from './types';

export const ROUTING_DO_SHARD_COUNT = 16;

type RoutingNamespaceBinding = {
  idFromName(name: string): unknown;
  get(id: unknown): DurableObjectStubBinding;
};

/**
 * Calculate shard ID from a key (hostname).
 * Uses 32-bit FNV-1a for stable distribution.
 */
export function getHostnameShardId(hostname: string, shardCount = ROUTING_DO_SHARD_COUNT): string {
  const key = hostname.toLowerCase();
  const FNV_PRIME = 0x01000193;
  const FNV_OFFSET_BASIS = 0x811c9dc5;

  let hash = FNV_OFFSET_BASIS;
  for (let i = 0; i < key.length; i++) {
    hash ^= key.charCodeAt(i);
    hash = Math.imul(hash, FNV_PRIME);
  }

  const shardIndex = (hash >>> 0) % shardCount;
  return shardIndex.toString(16); // 0-f for 16 shards
}

export function getRoutingDOStub(
  env: RoutingBindings & { ROUTING_DO: DurableObjectNamespace },
  hostname: string
): DurableObjectStubBinding {
  const namespace = env.ROUTING_DO as unknown as RoutingNamespaceBinding;
  const shardId = getHostnameShardId(hostname);
  const id = namespace.idFromName(`routing-shard-${shardId}`);
  return namespace.get(id);
}
