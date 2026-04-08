import type { ArtifactKind } from './models.ts';
import type { AppStorage, StorageType } from '../source/app-manifest-types.ts';

export type CanonicalResourceClass =
  | 'sql'
  | 'object_store'
  | 'kv'
  | 'queue'
  | 'vector_index'
  | 'analytics_store'
  | 'secret'
  | 'workflow_runtime'
  | 'durable_namespace';

export type CanonicalResourceBacking =
  | 'd1'
  | 'r2'
  | 'kv_namespace'
  | 'queue'
  | 'vectorize'
  | 'analytics_engine'
  | 'secret_ref'
  | 'workflow_binding'
  | 'durable_object_namespace';

export type CanonicalBindingContract =
  | 'sql'
  | 'object_store'
  | 'kv'
  | 'queue'
  | 'vector_index'
  | 'analytics_store'
  | 'workflow_runtime'
  | 'durable_namespace'
  | 'secret_text';

export type ManifestWorkloadKind = 'worker' | 'container' | 'service';
export type ServiceExecutionProfile = 'workers' | 'oci-service';

export interface CanonicalResourceDescriptor {
  /** Canonical flat storage type. */
  manifestType: StorageType;
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
 * Map the provider-neutral flat storage type to the canonical resource
 * descriptor. Previous versions of this table keyed on legacy Cloudflare
 * names (d1 / r2 / kv / ...). The flat schema uses provider-neutral names
 * (sql / object-store / key-value / ...), so this table mirrors those.
 */
const RESOURCE_DESCRIPTORS: Record<StorageType, CanonicalResourceDescriptor> = {
  sql: {
    manifestType: 'sql',
    resourceClass: 'sql',
    backing: 'd1',
    bindingType: 'sql',
  },
  'object-store': {
    manifestType: 'object-store',
    resourceClass: 'object_store',
    backing: 'r2',
    bindingType: 'object_store',
  },
  'key-value': {
    manifestType: 'key-value',
    resourceClass: 'kv',
    backing: 'kv_namespace',
    bindingType: 'kv',
  },
  secret: {
    manifestType: 'secret',
    resourceClass: 'secret',
    backing: 'secret_ref',
    bindingType: 'secret_text',
  },
  'vector-index': {
    manifestType: 'vector-index',
    resourceClass: 'vector_index',
    backing: 'vectorize',
    bindingType: 'vector_index',
  },
  queue: {
    manifestType: 'queue',
    resourceClass: 'queue',
    backing: 'queue',
    bindingType: 'queue',
  },
  'analytics-engine': {
    manifestType: 'analytics-engine',
    resourceClass: 'analytics_store',
    backing: 'analytics_engine',
    bindingType: 'analytics_store',
  },
  workflow: {
    manifestType: 'workflow',
    resourceClass: 'workflow_runtime',
    backing: 'workflow_binding',
    bindingType: 'workflow_runtime',
  },
  'durable-object': {
    manifestType: 'durable-object',
    resourceClass: 'durable_namespace',
    backing: 'durable_object_namespace',
    bindingType: 'durable_namespace',
  },
};

/**
 * Map from legacy Cloudflare resource type names to the new flat storage
 * type names. Kept so that older manifests persisted in the DB continue to
 * round-trip through this module without a schema migration.
 */
const LEGACY_ALIAS_TO_STORAGE_TYPE: Record<string, StorageType> = {
  d1: 'sql',
  r2: 'object-store',
  kv: 'key-value',
  secretRef: 'secret',
  vectorize: 'vector-index',
  analyticsEngine: 'analytics-engine',
  durableObject: 'durable-object',
  durable_namespace: 'durable-object',
  workflow_runtime: 'workflow',
  // Identity-map the canonical names so callers can query by either form.
  sql: 'sql',
  'object-store': 'object-store',
  'key-value': 'key-value',
  secret: 'secret',
  'vector-index': 'vector-index',
  queue: 'queue',
  'analytics-engine': 'analytics-engine',
  workflow: 'workflow',
  'durable-object': 'durable-object',
};

const WORKLOAD_DESCRIPTORS: Record<ManifestWorkloadKind, CanonicalWorkloadDescriptor> = {
  worker: {
    sourceKind: 'worker',
    executionProfile: 'workers',
    artifactKind: 'worker-bundle',
  },
  container: {
    sourceKind: 'container',
    executionProfile: 'oci-service',
    artifactKind: 'container-image',
  },
  service: {
    sourceKind: 'service',
    executionProfile: 'oci-service',
    artifactKind: 'container-image',
  },
};

export function getCanonicalResourceDescriptor(resource: AppStorage): CanonicalResourceDescriptor {
  const descriptor = RESOURCE_DESCRIPTORS[resource.type] ?? inferCanonicalResourceDescriptor(resource.type);
  if (!descriptor) {
    throw new Error(`Unsupported resource type: ${resource.type}`);
  }
  return descriptor;
}

export function inferCanonicalResourceDescriptor(
  manifestType: string,
): CanonicalResourceDescriptor | null {
  const normalizedType = LEGACY_ALIAS_TO_STORAGE_TYPE[manifestType];
  if (!normalizedType) return null;
  return RESOURCE_DESCRIPTORS[normalizedType] ?? null;
}

export function getCanonicalWorkloadDescriptor(sourceKind: ManifestWorkloadKind): CanonicalWorkloadDescriptor {
  return WORKLOAD_DESCRIPTORS[sourceKind];
}
