import type { ArtifactKind } from './models.ts';
import {
  type AppResource,
  APP_RESOURCE_TYPE_ALIASES,
  type LegacyAppResourceTypeAlias,
} from '../source/app-manifest-types.ts';

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
  manifestType: AppResource['type'];
  resourceClass: CanonicalResourceClass;
  backing: CanonicalResourceBacking;
  bindingType: CanonicalBindingContract;
}

export interface CanonicalWorkloadDescriptor {
  sourceKind: ManifestWorkloadKind;
  executionProfile: ServiceExecutionProfile;
  artifactKind: ArtifactKind;
}

const RESOURCE_DESCRIPTORS: Record<AppResource['type'], CanonicalResourceDescriptor> = {
  d1: {
    manifestType: 'd1',
    resourceClass: 'sql',
    backing: 'd1',
    bindingType: 'sql',
  },
  r2: {
    manifestType: 'r2',
    resourceClass: 'object_store',
    backing: 'r2',
    bindingType: 'object_store',
  },
  kv: {
    manifestType: 'kv',
    resourceClass: 'kv',
    backing: 'kv_namespace',
    bindingType: 'kv',
  },
  secretRef: {
    manifestType: 'secretRef',
    resourceClass: 'secret',
    backing: 'secret_ref',
    bindingType: 'secret_text',
  },
  vectorize: {
    manifestType: 'vectorize',
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
  analyticsEngine: {
    manifestType: 'analyticsEngine',
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
  durableObject: {
    manifestType: 'durableObject',
    resourceClass: 'durable_namespace',
    backing: 'durable_object_namespace',
    bindingType: 'durable_namespace',
  },
  workflow_runtime: {
    manifestType: 'workflow_runtime',
    resourceClass: 'workflow_runtime',
    backing: 'workflow_binding',
    bindingType: 'workflow_runtime',
  },
  durable_namespace: {
    manifestType: 'durable_namespace',
    resourceClass: 'durable_namespace',
    backing: 'durable_object_namespace',
    bindingType: 'durable_namespace',
  },
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

export function getCanonicalResourceDescriptor(resource: AppResource): CanonicalResourceDescriptor {
  const descriptor = RESOURCE_DESCRIPTORS[resource.type] ?? inferCanonicalResourceDescriptor(resource.type);
  if (!descriptor) {
    throw new Error(`Unsupported resource type: ${resource.type}`);
  }
  return {
    manifestType: resource.type,
    resourceClass: descriptor.resourceClass,
    backing: descriptor.backing,
    bindingType: descriptor.bindingType,
  };
}

export function inferCanonicalResourceDescriptor(
  manifestType: string,
): CanonicalResourceDescriptor | null {
  const normalizedType = (APP_RESOURCE_TYPE_ALIASES[manifestType as LegacyAppResourceTypeAlias] ?? manifestType) as AppResource['type'];
  if (!(normalizedType in RESOURCE_DESCRIPTORS)) {
    return null;
  }
  return RESOURCE_DESCRIPTORS[normalizedType];
}

export function getCanonicalWorkloadDescriptor(sourceKind: ManifestWorkloadKind): CanonicalWorkloadDescriptor {
  return WORKLOAD_DESCRIPTORS[sourceKind];
}
