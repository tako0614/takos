import type { DurableNamespaceBinding, KvStoreBinding } from '../../../shared/types/bindings.ts';

// Re-export routing primitives from shared/types so that consumers importing
// from this module continue to work without changes.
export type {
  RoutingStore,
  RoutingRecord,
  RoutingTarget,
  WeightedDeploymentTarget,
  HttpRoute,
  StoredHttpEndpoint,
} from '../../../shared/types/routing';

import type { RoutingStore } from '../../../shared/types/routing';
import type { RoutingTarget, RoutingRecord } from '../../../shared/types/routing';

export type RoutingDurableObjectNamespace = DurableNamespaceBinding;
export type RoutingKvNamespace = KvStoreBinding;

/**
 * Minimal bindings required for hostname routing resolution.
 *
 * Both takos-control and takos-dispatch can implement this.
 */
export type RoutingBindings = {
  HOSTNAME_ROUTING?: RoutingKvNamespace;
  ROUTING_DO?: RoutingDurableObjectNamespace;
  ROUTING_DO_PHASE?: string;
  ROUTING_STORE?: RoutingStore;
};

export type ParsedRoutingValue = {
  target: RoutingTarget | null;
  version?: number;
  updatedAt?: number;
  tombstoneUntil?: number;
  rawFormat: 'empty' | 'string' | 'json' | 'unknown';
};

export type ResolvedRouting = {
  target: RoutingTarget | null;
  tombstone: boolean;
  source: 'l1' | 'kv' | 'do' | 'kv_fallback' | 'store';
  kv?: ParsedRoutingValue;
  record?: RoutingRecord | null;
};
