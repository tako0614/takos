import type { ResourceCapability, ResourcePublicType } from '../../../shared/types/index.ts';

export type ResourceImplementation =
  | 'd1'
  | 'r2'
  | 'kv'
  | 'queue'
  | 'vectorize'
  | 'analytics_engine'
  | 'secret_ref'
  | 'workflow_binding'
  | 'durable_object_namespace';

export type ResourceDriver =
  | 'cloudflare-d1'
  | 'cloudflare-r2'
  | 'cloudflare-kv'
  | 'cloudflare-queue'
  | 'cloudflare-vectorize'
  | 'cloudflare-analytics-engine'
  | 'cloudflare-secret-ref'
  | 'cloudflare-workflow-binding'
  | 'cloudflare-durable-object-namespace'
  | 'takos-local-sql'
  | 'takos-local-object-store'
  | 'takos-local-kv'
  | 'takos-local-queue'
  | 'takos-local-vector-index'
  | 'takos-local-analytics-store'
  | 'takos-local-secret'
  | 'takos-local-workflow-runtime'
  | 'takos-local-durable-runtime'
  | 'takos-sql'
  | 'takos-object-store'
  | 'takos-kv'
  | 'takos-queue'
  | 'takos-vector-store'
  | 'takos-analytics-store'
  | 'takos-secret'
  | 'takos-workflow-runtime'
  | 'takos-durable-runtime';

const RESOURCE_CAPABILITY_BY_TYPE: Record<string, ResourceCapability> = {
  sql: 'sql',
  d1: 'sql',
  object_store: 'object_store',
  r2: 'object_store',
  kv: 'kv',
  queue: 'queue',
  vector_index: 'vector_index',
  vectorize: 'vector_index',
  analytics_store: 'analytics_store',
  analyticsEngine: 'analytics_store',
  analytics_engine: 'analytics_store',
  secret: 'secret',
  secretRef: 'secret',
  secret_ref: 'secret',
  workflow_runtime: 'workflow_runtime',
  workflow: 'workflow_runtime',
  workflow_binding: 'workflow_runtime',
  durable_namespace: 'durable_namespace',
  durableObject: 'durable_namespace',
  durable_object: 'durable_namespace',
  durable_object_namespace: 'durable_namespace',
};

const RESOURCE_IMPLEMENTATION_BY_CAPABILITY: Record<ResourceCapability, ResourceImplementation> = {
  sql: 'd1',
  object_store: 'r2',
  kv: 'kv',
  queue: 'queue',
  vector_index: 'vectorize',
  analytics_store: 'analytics_engine',
  secret: 'secret_ref',
  workflow_runtime: 'workflow_binding',
  durable_namespace: 'durable_object_namespace',
};

const RESOURCE_DRIVER_BY_CAPABILITY: Record<ResourceCapability, ResourceDriver> = {
  sql: 'cloudflare-d1',
  object_store: 'cloudflare-r2',
  kv: 'cloudflare-kv',
  queue: 'cloudflare-queue',
  vector_index: 'cloudflare-vectorize',
  analytics_store: 'cloudflare-analytics-engine',
  secret: 'cloudflare-secret-ref',
  workflow_runtime: 'cloudflare-workflow-binding',
  durable_namespace: 'cloudflare-durable-object-namespace',
};

const LOCAL_RESOURCE_DRIVER_BY_CAPABILITY: Record<ResourceCapability, ResourceDriver> = {
  sql: 'takos-local-sql',
  object_store: 'takos-local-object-store',
  kv: 'takos-local-kv',
  queue: 'takos-local-queue',
  vector_index: 'takos-local-vector-index',
  analytics_store: 'takos-local-analytics-store',
  secret: 'takos-local-secret',
  workflow_runtime: 'takos-local-workflow-runtime',
  durable_namespace: 'takos-local-durable-runtime',
};

const PORTABLE_RESOURCE_DRIVER_BY_CAPABILITY: Record<ResourceCapability, ResourceDriver> = {
  sql: 'takos-sql',
  object_store: 'takos-object-store',
  kv: 'takos-kv',
  queue: 'takos-queue',
  vector_index: 'takos-vector-store',
  analytics_store: 'takos-analytics-store',
  secret: 'takos-secret',
  workflow_runtime: 'takos-workflow-runtime',
  durable_namespace: 'takos-durable-runtime',
};

const RESOURCE_PUBLIC_TYPE_BY_CAPABILITY: Record<ResourceCapability, ResourcePublicType> = {
  sql: 'd1',
  object_store: 'r2',
  kv: 'kv',
  queue: 'queue',
  vector_index: 'vectorize',
  analytics_store: 'analyticsEngine',
  secret: 'secretRef',
  workflow_runtime: 'workflow',
  durable_namespace: 'durableObject',
};

const RESOURCE_QUERY_VALUES_BY_CAPABILITY: Record<ResourceCapability, string[]> = {
  sql: ['sql', 'd1'],
  object_store: ['object_store', 'r2'],
  kv: ['kv'],
  queue: ['queue'],
  vector_index: ['vector_index', 'vectorize'],
  analytics_store: ['analytics_store', 'analyticsEngine', 'analytics_engine'],
  secret: ['secret', 'secretRef', 'secret_ref'],
  workflow_runtime: ['workflow_runtime', 'workflow', 'workflow_binding'],
  durable_namespace: ['durable_namespace', 'durableObject', 'durable_object', 'durable_object_namespace'],
};

function parseResourceConfig(
  config?: string | Record<string, unknown> | null,
): Record<string, unknown> {
  if (!config) return {};
  if (typeof config === 'string') {
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
  const configCapability = parsedConfig.resourceCapability ?? parsedConfig.capability;
  if (typeof configCapability === 'string' && configCapability in RESOURCE_CAPABILITY_BY_TYPE) {
    return RESOURCE_CAPABILITY_BY_TYPE[configCapability];
  }
  if (!type) return null;
  return RESOURCE_CAPABILITY_BY_TYPE[type] ?? null;
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
  providerName: string = 'cloudflare',
): ResourceDriver | null {
  const capability = toResourceCapability(typeOrCapability);
  if (!capability) return null;
  switch (providerName) {
    case 'cloudflare':
      return RESOURCE_DRIVER_BY_CAPABILITY[capability];
    case 'local':
      return LOCAL_RESOURCE_DRIVER_BY_CAPABILITY[capability];
    case 'aws':
    case 'gcp':
    case 'k8s':
      return PORTABLE_RESOURCE_DRIVER_BY_CAPABILITY[capability];
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
  if (typeof configImplementation === 'string') {
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

export function isCanonicalResourceCapability(type?: string | null): type is ResourceCapability {
  if (!type) return false;
  return Object.prototype.hasOwnProperty.call(RESOURCE_IMPLEMENTATION_BY_CAPABILITY, type);
}

export function toPublicResourceType(
  type?: string | null,
  config?: string | Record<string, unknown> | null,
): ResourcePublicType | null {
  const capability = toResourceCapability(type, config);
  if (!capability) return null;
  return RESOURCE_PUBLIC_TYPE_BY_CAPABILITY[capability];
}
