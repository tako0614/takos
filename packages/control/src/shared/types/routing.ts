/**
 * Routing store abstraction used by shared Env types.
 *
 * This file lives in shared/types so that env.ts does not depend on
 * application-layer modules (dependency inversion).  The canonical
 * application-layer routing types re-export from here to keep a
 * single source of truth.
 */

export type RoutingRecord = {
  hostname: string;
  target: RoutingTarget | null;
  version: number;
  updatedAt: number;
  tombstoneUntil?: number;
};

export type RoutingTarget =
  | { type: "deployments"; deployments: WeightedDeploymentTarget[] }
  | { type: "http-endpoint-set"; endpoints: StoredHttpEndpoint[] };

export type WeightedDeploymentTarget = {
  routeRef: string;
  weight: number;
  // Optional metadata for observability/debugging.
  deploymentId?: string;
  status?: "active" | "canary" | "rollback";
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
      kind: "service-ref";
      ref: string;
    }
    | {
      kind: "http-url";
      baseUrl: string;
    };
  timeoutMs?: number;
};

export type RoutingStore = {
  getRecord(hostname: string): Promise<RoutingRecord | null>;
  putRecord(
    hostname: string,
    target: RoutingTarget,
    updatedAt: number,
  ): Promise<RoutingRecord>;
  deleteRecord(
    hostname: string,
    tombstoneTtlMs: number,
    updatedAt: number,
  ): Promise<RoutingRecord>;
};
