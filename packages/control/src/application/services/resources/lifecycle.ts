import type { Env } from '../../../shared/types';
import { generateId } from '../../../shared/utils';
import { insertFailedResource, insertResource } from './store';
import { CloudflareResourceService, type CloudflareManagedResourceType } from '../../../platform/providers/cloudflare/resources.ts';
import type { ResourceCapability, ResourceType } from '../../../shared/types';
import { resolveResourceDriver, resolveResourceImplementation, toPublicResourceType } from './capabilities';
import {
  deletePortableManagedResource,
  ensurePortableManagedResource,
  resolvePortableResourceReferenceId,
} from './portable-runtime.ts';

type ManagedResourceProvider = 'cloudflare' | 'local' | 'aws' | 'gcp' | 'k8s';

type ProvisionManagedResourceInput = {
  id?: string;
  timestamp?: string;
  ownerId: string;
  spaceId?: string | null;
  groupId?: string | null;
  name: string;
  type: string;
  providerResourceName?: string;
  publicType?: ResourceType;
  semanticType?: ResourceCapability;
  providerName?: string;
  persist?: boolean;
  config?: Record<string, unknown>;
  recordFailure?: boolean;
  vectorize?: {
    dimensions: number;
    metric: 'cosine' | 'euclidean' | 'dot-product';
  };
  vectorIndex?: {
    dimensions: number;
    metric: 'cosine' | 'euclidean' | 'dot-product';
  };
  queue?: {
    deliveryDelaySeconds?: number;
  };
  analyticsEngine?: {
    dataset?: string;
  };
  analyticsStore?: {
    dataset?: string;
  };
  workflow?: {
    service: string;
    export: string;
    timeoutMs?: number;
    maxRetries?: number;
  };
  workflowRuntime?: {
    service: string;
    export: string;
    timeoutMs?: number;
    maxRetries?: number;
  };
  durableNamespace?: {
    className: string;
    scriptName?: string;
  };
};

function normalizeManagedResourceProvider(providerName?: string | null): ManagedResourceProvider {
  switch (providerName) {
    case 'local':
    case 'aws':
    case 'gcp':
    case 'k8s':
      return providerName;
    case 'cloudflare':
    default:
      return 'cloudflare';
  }
}

function inferDefaultManagedResourceProvider(env: Pick<Env, 'CF_ACCOUNT_ID' | 'CF_API_TOKEN'>): ManagedResourceProvider {
  return env.CF_ACCOUNT_ID && env.CF_API_TOKEN ? 'cloudflare' : 'local';
}

async function resolvePortableProviderResourceId(input: {
  id: string;
  semanticType: ResourceCapability;
  providerName: ManagedResourceProvider;
  providerResourceName: string;
  config?: Record<string, unknown>;
}): Promise<string | null> {
  const resourceRef = {
    id: input.id,
    provider_name: input.providerName,
    provider_resource_name: input.providerResourceName,
    ...(input.config ? { config: input.config } : {}),
  };

  switch (input.semanticType) {
    case 'queue':
    case 'secret':
      return resolvePortableResourceReferenceId(resourceRef, input.semanticType);
    case 'sql':
    case 'kv':
    case 'vector_index':
      return `${input.providerResourceName}-${input.id}`;
    default:
      return null;
  }
}

export async function provisionManagedResource(
  env: Env,
  input: ProvisionManagedResourceInput
): Promise<{
  id: string;
  providerResourceId: string | null;
  providerResourceName: string;
}> {
  const id = input.id || generateId();
  const timestamp = input.timestamp || new Date().toISOString();
  const semanticType = input.semanticType ?? (input.type as ResourceCapability);
  const publicType = input.publicType ?? toPublicResourceType(semanticType) ?? (input.type as ResourceType);
  const providerName = normalizeManagedResourceProvider(input.providerName ?? inferDefaultManagedResourceProvider(env));
  const driver = resolveResourceDriver(semanticType, providerName);
  const persist = input.persist ?? true;
  const providerResourceName = input.providerResourceName ?? `${input.type}-${id}`;
  const workflow = input.workflow ?? input.workflowRuntime;
  const implementation = resolveResourceImplementation(semanticType) ?? (input.type as CloudflareManagedResourceType);

  try {
    if (providerName !== 'cloudflare') {
      await ensurePortableManagedResource({
        id,
        provider_name: providerName,
        provider_resource_name: providerResourceName,
        ...(input.config ? { config: input.config } : {}),
      }, semanticType);
      const portableProviderResourceId = await resolvePortableProviderResourceId({
        id,
        semanticType,
        providerName,
        providerResourceName,
        ...(input.config ? { config: input.config } : {}),
      });

      if (persist) {
        await insertResource(env.DB, {
          id,
          owner_id: input.ownerId,
          name: input.name,
          type: publicType,
          semantic_type: semanticType,
          driver,
          provider_name: providerName,
          status: 'active',
          provider_resource_id: portableProviderResourceId,
          provider_resource_name: providerResourceName,
          config: input.config || {},
          space_id: input.spaceId || null,
          group_id: input.groupId || null,
          created_at: timestamp,
          updated_at: timestamp,
        });
      }

      return {
        id,
        providerResourceId: portableProviderResourceId,
        providerResourceName,
      };
    }

    const provider = new CloudflareResourceService(env);
    const created = await provider.createResource(implementation as CloudflareManagedResourceType, providerResourceName, {
      ...(input.vectorize || input.vectorIndex ? { vectorize: input.vectorize ?? input.vectorIndex } : {}),
      ...(input.queue ? { queue: input.queue } : {}),
      ...(input.analyticsEngine || input.analyticsStore ? { analyticsEngine: input.analyticsEngine ?? input.analyticsStore } : {}),
      ...(workflow ? { workflow } : {}),
    });

    if (persist) {
      await insertResource(env.DB, {
        id,
        owner_id: input.ownerId,
        name: input.name,
        type: publicType,
        semantic_type: semanticType,
        driver,
        provider_name: providerName,
        status: 'active',
        provider_resource_id: created.providerResourceId,
        provider_resource_name: created.providerResourceName,
        config: input.config || {},
        space_id: input.spaceId || null,
        group_id: input.groupId || null,
        created_at: timestamp,
        updated_at: timestamp,
      });
    }

    return {
      id,
      providerResourceId: created.providerResourceId,
      providerResourceName: created.providerResourceName,
    };
  } catch (error) {
    if (persist && input.recordFailure) {
      await insertFailedResource(env.DB, {
        id,
        owner_id: input.ownerId,
        name: input.name,
        type: publicType,
        semantic_type: semanticType,
        driver,
        provider_name: providerName,
        provider_resource_name: providerResourceName,
        config: {
          ...(input.config || {}),
          error: error instanceof Error ? error.message : String(error),
        },
        space_id: input.spaceId || null,
        group_id: input.groupId || null,
        created_at: timestamp,
        updated_at: timestamp,
      });
    }
    throw error;
  }
}

export async function deleteManagedResource(
  env: Pick<Env, 'CF_ACCOUNT_ID' | 'CF_API_TOKEN' | 'WFP_DISPATCH_NAMESPACE'>,
  input: {
    type: string;
    providerName?: string | null;
    providerResourceId?: string | null;
    providerResourceName?: string | null;
  },
): Promise<void> {
  const providerName = normalizeManagedResourceProvider(input.providerName ?? inferDefaultManagedResourceProvider(env));
  if (providerName !== 'cloudflare') {
    await deletePortableManagedResource({
      id: input.providerResourceId ?? input.providerResourceName ?? input.type,
      provider_name: providerName,
      provider_resource_name: input.providerResourceName ?? undefined,
    }, input.type);
    return;
  }
  const provider = new CloudflareResourceService(env);
  const implementation = resolveResourceImplementation(input.type) ?? (input.type as CloudflareManagedResourceType);
  await provider.deleteResource({
    type: implementation,
    providerResourceId: input.providerResourceId,
    providerResourceName: input.providerResourceName,
  });
}

export const provisionCloudflareResource = provisionManagedResource;
