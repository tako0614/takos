import type {
  ResourceCapability,
  ResourcePublicType,
} from "../../../shared/types/index.ts";

/**
 * The single backend axis for managed resources. `cloudflare` is the native
 * backend; `local` is the self-hosted portable backend (see
 * {@link PortableResourceBackend}).
 *
 * Multi-cloud materialization is operator-substrate scope owned by Takosumi
 * runner policy, not the Takos worker. This worker accepts only the native
 * `cloudflare` backend and the portable self-hosted `local` backend.
 */
export type ResourceBackend = "cloudflare" | "local";

/**
 * The portable backend axis is the resource backend axis minus the native
 * `cloudflare` backend, so the two stay in lockstep by construction.
 */
export type PortableResourceBackend = Exclude<ResourceBackend, "cloudflare">;

export function normalizeResourceBackend(
  backendName?: string | null,
): ResourceBackend {
  const normalized = String(backendName ?? "")
    .trim()
    .toLowerCase();
  if (!normalized) return "cloudflare";
  switch (normalized) {
    case "local":
      return "local";
    case "cloudflare":
      return "cloudflare";
    default:
      throw new Error(
        `unsupported resource backend '${normalized}'; expected cloudflare or local`,
      );
  }
}

export function normalizePortableResourceBackend(
  _backendName?: string | null,
): PortableResourceBackend {
  return "local";
}

export type ResourceImplementation =
  | "d1"
  | "r2"
  | "kv"
  | "queue"
  | "vectorize"
  | "analytics_engine"
  | "secret_ref"
  | "workflow_binding"
  | "durable_object_namespace";

export type ResourceDriver =
  | "cloudflare-d1"
  | "cloudflare-r2"
  | "cloudflare-kv"
  | "cloudflare-queue"
  | "cloudflare-vectorize"
  | "cloudflare-analytics-engine"
  | "cloudflare-secret-ref"
  | "cloudflare-workflow-binding"
  | "cloudflare-durable-object-namespace"
  | "takos-local-sql"
  | "takos-local-object-store"
  | "takos-local-kv"
  | "takos-local-queue"
  | "takos-local-vector-index"
  | "takos-local-analytics-store"
  | "takos-local-secret"
  | "takos-local-workflow-runtime"
  | "takos-local-durable-runtime"
  | "takos-sql"
  | "takos-object-store"
  | "takos-kv"
  | "takos-queue"
  | "takos-vector-store"
  | "takos-analytics-store"
  | "takos-secret"
  | "takos-workflow-runtime"
  | "takos-durable-runtime";

const CURRENT_RESOURCE_CAPABILITY_BY_TYPE: Record<
  ResourcePublicType,
  ResourceCapability
> = {
  sql: "sql",
  "object-store": "object_store",
  "key-value": "kv",
  queue: "queue",
  "vector-index": "vector_index",
  "analytics-engine": "analytics_store",
  secret: "secret",
  workflow: "workflow_runtime",
  "durable-object": "durable_namespace",
};

const RESOURCE_CAPABILITY_BY_TYPE: Record<string, ResourceCapability> = {
  sql: "sql",
  "object-store": "object_store",
  "key-value": "kv",
  queue: "queue",
  "vector-index": "vector_index",
  "analytics-engine": "analytics_store",
  secret: "secret",
  workflow: "workflow_runtime",
  "durable-object": "durable_namespace",
  object_store: "object_store",
  kv: "kv",
  vector_index: "vector_index",
  analytics_store: "analytics_store",
  workflow_runtime: "workflow_runtime",
  durable_namespace: "durable_namespace",
};

const RESOURCE_IMPLEMENTATION_BY_CAPABILITY: Record<
  ResourceCapability,
  ResourceImplementation
> = {
  sql: "d1",
  object_store: "r2",
  kv: "kv",
  queue: "queue",
  vector_index: "vectorize",
  analytics_store: "analytics_engine",
  secret: "secret_ref",
  workflow_runtime: "workflow_binding",
  durable_namespace: "durable_object_namespace",
};

const RESOURCE_DRIVER_BY_CAPABILITY: Record<
  ResourceCapability,
  ResourceDriver
> = {
  sql: "cloudflare-d1",
  object_store: "cloudflare-r2",
  kv: "cloudflare-kv",
  queue: "cloudflare-queue",
  vector_index: "cloudflare-vectorize",
  analytics_store: "cloudflare-analytics-engine",
  secret: "cloudflare-secret-ref",
  workflow_runtime: "cloudflare-workflow-binding",
  durable_namespace: "cloudflare-durable-object-namespace",
};

const LOCAL_RESOURCE_DRIVER_BY_CAPABILITY: Record<
  ResourceCapability,
  ResourceDriver
> = {
  sql: "takos-local-sql",
  object_store: "takos-local-object-store",
  kv: "takos-local-kv",
  queue: "takos-local-queue",
  vector_index: "takos-local-vector-index",
  analytics_store: "takos-local-analytics-store",
  secret: "takos-local-secret",
  workflow_runtime: "takos-local-workflow-runtime",
  durable_namespace: "takos-local-durable-runtime",
};

const RESOURCE_PUBLIC_TYPE_BY_CAPABILITY: Record<
  ResourceCapability,
  ResourcePublicType
> = {
  sql: "sql",
  object_store: "object-store",
  kv: "key-value",
  queue: "queue",
  vector_index: "vector-index",
  analytics_store: "analytics-engine",
  secret: "secret",
  workflow_runtime: "workflow",
  durable_namespace: "durable-object",
};

const RESOURCE_QUERY_VALUES_BY_CAPABILITY: Record<
  ResourceCapability,
  ResourcePublicType[]
> = {
  sql: ["sql"],
  object_store: ["object-store"],
  kv: ["key-value"],
  queue: ["queue"],
  vector_index: ["vector-index"],
  analytics_store: ["analytics-engine"],
  secret: ["secret"],
  workflow_runtime: ["workflow"],
  durable_namespace: ["durable-object"],
};

function parseResourceConfig(
  config?: string | Record<string, unknown> | null,
): Record<string, unknown> {
  if (!config) return {};
  if (typeof config === "string") {
    try {
      return JSON.parse(config) as Record<string, unknown>;
    } catch {
      return {};
    }
  }
  return config;
}

export function toResourceCapability(
  type?: string | null,
  config?: string | Record<string, unknown> | null,
): ResourceCapability | null {
  const parsedConfig = parseResourceConfig(config);
  const configCapability =
    parsedConfig.resourceCapability ?? parsedConfig.capability;
  if (
    typeof configCapability === "string" &&
    configCapability in RESOURCE_CAPABILITY_BY_TYPE
  ) {
    return RESOURCE_CAPABILITY_BY_TYPE[configCapability];
  }
  if (!type) return null;
  return RESOURCE_CAPABILITY_BY_TYPE[type] ?? null;
}

export function toCurrentResourceCapability(
  type?: string | null,
): ResourceCapability | null {
  const normalized = typeof type === "string" ? type.trim() : "";
  if (!normalized) return null;
  return (
    CURRENT_RESOURCE_CAPABILITY_BY_TYPE[normalized as ResourcePublicType] ??
    null
  );
}

export function currentResourceTypeList(): string {
  return Object.keys(CURRENT_RESOURCE_CAPABILITY_BY_TYPE).join(", ");
}

export function resolveResourceImplementation(
  typeOrCapability?: string | null,
): ResourceImplementation | null {
  const capability = toResourceCapability(typeOrCapability);
  if (!capability) return null;
  return RESOURCE_IMPLEMENTATION_BY_CAPABILITY[capability];
}

export function resolveResourceDriver(
  typeOrCapability?: string | null,
  backendName: string = "cloudflare",
): ResourceDriver | null {
  const capability = toResourceCapability(typeOrCapability);
  if (!capability) return null;
  switch (backendName) {
    case "cloudflare":
      return RESOURCE_DRIVER_BY_CAPABILITY[capability];
    case "local":
      return LOCAL_RESOURCE_DRIVER_BY_CAPABILITY[capability];
    default:
      return null;
  }
}

export function getStoredResourceImplementation(
  type?: string | null,
  config?: string | Record<string, unknown> | null,
): ResourceImplementation | null {
  const parsedConfig = parseResourceConfig(config);
  const configImplementation = parsedConfig.implementation;
  if (typeof configImplementation === "string") {
    return configImplementation as ResourceImplementation;
  }

  const capability = toResourceCapability(type, parsedConfig);
  if (!capability || !type) return null;
  if (type === capability) {
    return null;
  }
  if (type in RESOURCE_CAPABILITY_BY_TYPE) {
    return resolveResourceImplementation(capability);
  }
  return type as ResourceImplementation;
}

export function getResourceTypeQueryValues(typeOrCapability: string): string[] {
  const capability = toResourceCapability(typeOrCapability);
  if (!capability) return [typeOrCapability];
  return RESOURCE_QUERY_VALUES_BY_CAPABILITY[capability];
}

export function isCanonicalResourceCapability(
  type?: string | null,
): type is ResourceCapability {
  if (!type) return false;
  return Object.prototype.hasOwnProperty.call(
    RESOURCE_IMPLEMENTATION_BY_CAPABILITY,
    type,
  );
}

export function toPublicResourceType(
  type?: string | null,
  config?: string | Record<string, unknown> | null,
): ResourcePublicType | null {
  const capability = toResourceCapability(type, config);
  if (!capability) return null;
  return RESOURCE_PUBLIC_TYPE_BY_CAPABILITY[capability];
}

/**
 * The single source of truth for the canonical resource capability set, in the
 * stable public ordering. Other modules (e.g. the deployment canonical model)
 * derive their per-resource lookup tables over this list instead of
 * re-declaring the resource vocabulary.
 */
export const CANONICAL_RESOURCE_CAPABILITIES: readonly ResourceCapability[] = [
  "sql",
  "object_store",
  "kv",
  "queue",
  "vector_index",
  "analytics_store",
  "secret",
  "workflow_runtime",
  "durable_namespace",
];

/**
 * Strict public-type → capability resolution. Unlike {@link toResourceCapability}
 * this only accepts the backend-independent public type names
 * (sql / object-store / key-value / ...), mirroring the manifest vocabulary.
 */
export function resourceCapabilityFromPublicType(
  publicType: ResourcePublicType,
): ResourceCapability {
  return CURRENT_RESOURCE_CAPABILITY_BY_TYPE[publicType];
}

/**
 * Capability → backend-independent public type. The inverse of
 * {@link resourceCapabilityFromPublicType}.
 */
export function resourcePublicTypeFromCapability(
  capability: ResourceCapability,
): ResourcePublicType {
  return RESOURCE_PUBLIC_TYPE_BY_CAPABILITY[capability];
}
