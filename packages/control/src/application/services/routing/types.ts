import type { DurableNamespaceBinding, KvStoreBinding } from '../../../shared/types/bindings.ts';

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

export type WeightedDeploymentTarget = {
  routeRef: string;
  weight: number;
  // Optional metadata for observability/debugging.
  deploymentId?: string;
  status?: 'active' | 'canary' | 'rollback';
};

export type HttpRoute = {
  pathPrefix?: string;
  methods?: string[];
};

export type StoredHttpEndpoint = {
  name: string;
  routes: HttpRoute[];
  target:
    | {
        kind: 'service-ref';
        ref: string;
      }
    | {
        kind: 'http-url';
        baseUrl: string;
      };
  timeoutMs?: number;
};

export type RoutingTarget =
  | { type: 'deployments'; deployments: WeightedDeploymentTarget[] }
  | { type: 'http-endpoint-set'; endpoints: StoredHttpEndpoint[] };

export type RoutingRecord = {
  hostname: string;
  target: RoutingTarget | null;
  version: number;
  updatedAt: number;
  tombstoneUntil?: number;
};

export type RoutingStore = {
  getRecord(hostname: string): Promise<RoutingRecord | null>;
  putRecord(hostname: string, target: RoutingTarget, updatedAt: number): Promise<RoutingRecord>;
  deleteRecord(hostname: string, tombstoneTtlMs: number, updatedAt: number): Promise<RoutingRecord>;
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
