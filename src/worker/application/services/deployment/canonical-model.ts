import type { ArtifactKind } from "./models.ts";

export type CanonicalManifestResourceType =
  | "sql"
  | "object-store"
  | "key-value"
  | "queue"
  | "vector-index"
  | "secret"
  | "analytics-engine"
  | "workflow"
  | "durable-object";

export type CanonicalManifestResourceSpec = {
  type: CanonicalManifestResourceType;
  bind?: string;
  migrations?: string;
  queue?: {
    maxRetries?: number;
    deadLetterQueue?: string;
  };
  vectorIndex?: {
    dimensions?: number;
    metric?: "cosine" | "euclidean" | "dot-product";
  };
  generate?: boolean;
  workflow?: {
    service?: string;
    export?: string;
    timeoutMs?: number;
    maxRetries?: number;
  };
  durableObject?: {
    className?: string;
    scriptName?: string;
  };
};

export type CanonicalResourceClass =
  | "sql"
  | "object_store"
  | "kv"
  | "queue"
  | "vector_index"
  | "analytics_store"
  | "secret"
  | "workflow_runtime"
  | "durable_namespace";

export type CanonicalResourceBacking =
  | "d1"
  | "r2"
  | "kv_namespace"
  | "queue"
  | "vectorize"
  | "analytics_engine"
  | "secret_ref"
  | "workflow_binding"
  | "durable_object_namespace";

export type CanonicalBindingContract =
  | "sql"
  | "object_store"
  | "kv"
  | "queue"
  | "vector_index"
  | "analytics_store"
  | "workflow_runtime"
  | "durable_namespace"
  | "secret_text";

export type ManifestWorkloadKind = "worker" | "container" | "service";
export type ServiceExecutionProfile = "workers" | "oci-service";

export interface CanonicalResourceDescriptor {
  manifestType: CanonicalManifestResourceType;
  resourceClass: CanonicalResourceClass;
  backing: CanonicalResourceBacking;
  bindingType: CanonicalBindingContract;
}

export interface CanonicalWorkloadDescriptor {
  sourceKind: ManifestWorkloadKind;
  executionProfile: ServiceExecutionProfile;
  artifactKind: ArtifactKind;
}

/**
 * Map the backend-independent flat storage type to the canonical resource
 * descriptor. The flat schema uses backend-independent names
 * (sql / object-store / key-value / ...), so this table mirrors those.
 */
const RESOURCE_DESCRIPTORS: Record<
  CanonicalManifestResourceType,
  CanonicalResourceDescriptor
> = {
  sql: {
    manifestType: "sql",
    resourceClass: "sql",
    backing: "d1",
    bindingType: "sql",
  },
  "object-store": {
    manifestType: "object-store",
    resourceClass: "object_store",
    backing: "r2",
    bindingType: "object_store",
  },
  "key-value": {
    manifestType: "key-value",
    resourceClass: "kv",
    backing: "kv_namespace",
    bindingType: "kv",
  },
  secret: {
    manifestType: "secret",
    resourceClass: "secret",
    backing: "secret_ref",
    bindingType: "secret_text",
  },
  "vector-index": {
    manifestType: "vector-index",
    resourceClass: "vector_index",
    backing: "vectorize",
    bindingType: "vector_index",
  },
  queue: {
    manifestType: "queue",
    resourceClass: "queue",
    backing: "queue",
    bindingType: "queue",
  },
  "analytics-engine": {
    manifestType: "analytics-engine",
    resourceClass: "analytics_store",
    backing: "analytics_engine",
    bindingType: "analytics_store",
  },
  workflow: {
    manifestType: "workflow",
    resourceClass: "workflow_runtime",
    backing: "workflow_binding",
    bindingType: "workflow_runtime",
  },
  "durable-object": {
    manifestType: "durable-object",
    resourceClass: "durable_namespace",
    backing: "durable_object_namespace",
    bindingType: "durable_namespace",
  },
};

const CANONICAL_RESOURCE_TYPES: Record<string, CanonicalManifestResourceType> =
  {
    sql: "sql",
    "object-store": "object-store",
    "key-value": "key-value",
    secret: "secret",
    "vector-index": "vector-index",
    queue: "queue",
    "analytics-engine": "analytics-engine",
    workflow: "workflow",
    "durable-object": "durable-object",
  };

const WORKLOAD_DESCRIPTORS: Record<
  ManifestWorkloadKind,
  CanonicalWorkloadDescriptor
> = {
  worker: {
    sourceKind: "worker",
    executionProfile: "workers",
    artifactKind: "worker-bundle",
  },
  container: {
    sourceKind: "container",
    executionProfile: "oci-service",
    artifactKind: "container-image",
  },
  service: {
    sourceKind: "service",
    executionProfile: "oci-service",
    artifactKind: "container-image",
  },
};

export function getCanonicalResourceDescriptor(
  resource: CanonicalManifestResourceSpec,
): CanonicalResourceDescriptor {
  const descriptor = RESOURCE_DESCRIPTORS[resource.type] ??
    inferCanonicalResourceDescriptor(resource.type);
  if (!descriptor) {
    throw new Error(`Unsupported resource type: ${resource.type}`);
  }
  return descriptor;
}

export function inferCanonicalResourceDescriptor(
  manifestType: string,
): CanonicalResourceDescriptor | null {
  const normalizedType = CANONICAL_RESOURCE_TYPES[manifestType];
  if (!normalizedType) return null;
  return RESOURCE_DESCRIPTORS[normalizedType] ?? null;
}

export function getCanonicalWorkloadDescriptor(
  sourceKind: ManifestWorkloadKind,
): CanonicalWorkloadDescriptor {
  return WORKLOAD_DESCRIPTORS[sourceKind];
}
