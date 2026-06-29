import type {
  ResourceCapability,
  ResourcePublicType,
} from "../../../shared/types/index.ts";
import {
  CANONICAL_RESOURCE_CAPABILITIES,
  resourcePublicTypeFromCapability,
} from "../resources/capabilities.ts";

/**
 * The canonical manifest resource type is exactly the backend-independent
 * public resource type vocabulary owned by `resources/capabilities.ts`. It is
 * aliased (not re-declared) so the resource type set has a single source of
 * truth.
 */
export type CanonicalManifestResourceType = ResourcePublicType;

export type CanonicalManifestResourceSpec = {
  type: CanonicalManifestResourceType;
  bind?: string;
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

/**
 * The canonical resource class is exactly the resource capability vocabulary
 * owned by `resources/capabilities.ts`.
 */
export type CanonicalResourceClass = ResourceCapability;

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

export interface CanonicalResourceDescriptor {
  manifestType: CanonicalManifestResourceType;
  resourceClass: CanonicalResourceClass;
  backing: CanonicalResourceBacking;
  bindingType: CanonicalBindingContract;
}

/**
 * Canonical-model-owned vocabularies, keyed by resource capability. `backing`
 * and `bindingType` differ from the capability / implementation names owned by
 * `resources/capabilities.ts` (e.g. kv → `kv_namespace`, secret → `secret_text`)
 * so they stay declared here, but the resource type set itself is derived from
 * the capability list rather than re-listed.
 */
const RESOURCE_BACKING_BY_CAPABILITY: Record<
  CanonicalResourceClass,
  CanonicalResourceBacking
> = {
  sql: "d1",
  object_store: "r2",
  kv: "kv_namespace",
  queue: "queue",
  vector_index: "vectorize",
  analytics_store: "analytics_engine",
  secret: "secret_ref",
  workflow_runtime: "workflow_binding",
  durable_namespace: "durable_object_namespace",
};

const RESOURCE_BINDING_TYPE_BY_CAPABILITY: Record<
  CanonicalResourceClass,
  CanonicalBindingContract
> = {
  sql: "sql",
  object_store: "object_store",
  kv: "kv",
  queue: "queue",
  vector_index: "vector_index",
  analytics_store: "analytics_store",
  secret: "secret_text",
  workflow_runtime: "workflow_runtime",
  durable_namespace: "durable_namespace",
};

/**
 * The canonical descriptor table is derived from the capability list owned by
 * `resources/capabilities.ts`. The flat schema uses backend-independent names
 * (sql / object-store / key-value / ...), so each manifest type maps to its
 * capability and the canonical-model-owned `backing` / `bindingType` for it.
 */
const RESOURCE_DESCRIPTORS: Record<
  CanonicalManifestResourceType,
  CanonicalResourceDescriptor
> = Object.fromEntries(
  CANONICAL_RESOURCE_CAPABILITIES.map((capability) => {
    const manifestType = resourcePublicTypeFromCapability(capability);
    return [manifestType, {
      manifestType,
      resourceClass: capability,
      backing: RESOURCE_BACKING_BY_CAPABILITY[capability],
      bindingType: RESOURCE_BINDING_TYPE_BY_CAPABILITY[capability],
    }] as const;
  }),
) as Record<CanonicalManifestResourceType, CanonicalResourceDescriptor>;

export function inferCanonicalResourceDescriptor(
  manifestType: string,
): CanonicalResourceDescriptor | null {
  return Object.prototype.hasOwnProperty.call(RESOURCE_DESCRIPTORS, manifestType)
    ? RESOURCE_DESCRIPTORS[manifestType as CanonicalManifestResourceType]
    : null;
}
