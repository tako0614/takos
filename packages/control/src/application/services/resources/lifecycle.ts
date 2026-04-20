import type { Env } from "../../../shared/types/index.ts";
import { generateId } from "../../../shared/utils/index.ts";
import { insertFailedResource, insertResource } from "./store.ts";
import {
  type CloudflareManagedResourceType,
  CloudflareResourceService,
} from "../../../platform/backends/cloudflare/resources.ts";
import type {
  ResourceCapability,
  ResourceType,
} from "../../../shared/types/index.ts";
import {
  resolveResourceDriver,
  resolveResourceImplementation,
  toPublicResourceType,
} from "./capabilities.ts";
import {
  deletePortableManagedResource,
  ensurePortableManagedResource,
  resolvePortableResourceReferenceId,
} from "./portable-runtime.ts";

type ManagedResourceBackend = "cloudflare" | "local" | "aws" | "gcp" | "k8s";

type ProvisionManagedResourceInput = {
  id?: string;
  timestamp?: string;
  ownerId: string;
  spaceId?: string | null;
  groupId?: string | null;
  name: string;
  type: string;
  backingResourceName?: string;
  publicType?: ResourceType;
  semanticType?: ResourceCapability;
  backendName?: string;
  persist?: boolean;
  config?: Record<string, unknown>;
  recordFailure?: boolean;
  vectorize?: {
    dimensions: number;
    metric: "cosine" | "euclidean" | "dot-product";
  };
  vectorIndex?: {
    dimensions: number;
    metric: "cosine" | "euclidean" | "dot-product";
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

function normalizeManagedResourceBackend(
  backendName?: string | null,
): ManagedResourceBackend {
  switch (backendName) {
    case "local":
    case "aws":
    case "gcp":
    case "k8s":
      return backendName;
    case "cloudflare":
    default:
      return "cloudflare";
  }
}

function readEnvString(env: object, key: string): string | undefined {
  const value = Reflect.get(env, key);
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : undefined;
}

export function inferDefaultManagedResourceBackend(
  env: Partial<Env>,
): ManagedResourceBackend {
  const configuredBackend = readEnvString(env, "TAKOS_RESOURCE_BACKEND");
  if (configuredBackend) {
    return normalizeManagedResourceBackend(configuredBackend);
  }
  if (env.CF_ACCOUNT_ID && env.CF_API_TOKEN) return "cloudflare";
  if (
    env.AWS_REGION || env.AWS_ECS_REGION || env.AWS_ECS_CLUSTER_ARN
  ) {
    return "aws";
  }
  if (env.GCP_PROJECT_ID || env.GCP_REGION || env.GCP_CLOUD_RUN_REGION) {
    return "gcp";
  }
  if (env.K8S_NAMESPACE) return "k8s";
  return "local";
}

async function resolvePortableBackendResourceId(input: {
  id: string;
  semanticType: ResourceCapability;
  backendName: ManagedResourceBackend;
  backingResourceName: string;
  config?: Record<string, unknown>;
}): Promise<string | null> {
  const resourceRef = {
    id: input.id,
    backend_name: input.backendName,
    backing_resource_name: input.backingResourceName,
    ...(input.config ? { config: input.config } : {}),
  };

  switch (input.semanticType) {
    case "queue":
    case "secret":
      return resolvePortableResourceReferenceId(
        resourceRef,
        input.semanticType,
      );
    case "sql":
    case "kv":
    case "vector_index":
      return `${input.backingResourceName}-${input.id}`;
    default:
      return null;
  }
}

export async function provisionManagedResource(
  env: Env,
  input: ProvisionManagedResourceInput,
): Promise<{
  id: string;
  backingResourceId: string | null;
  backingResourceName: string;
}> {
  const id = input.id || generateId();
  const timestamp = input.timestamp || new Date().toISOString();
  const semanticType = input.semanticType ?? (input.type as ResourceCapability);
  const publicType = input.publicType ?? toPublicResourceType(semanticType) ??
    (input.type as ResourceType);
  const backendName = normalizeManagedResourceBackend(
    input.backendName ?? inferDefaultManagedResourceBackend(env),
  );
  const driver = resolveResourceDriver(semanticType, backendName);
  const persist = input.persist ?? true;
  const backingResourceName = input.backingResourceName ??
    `${input.type}-${id}`;
  const workflow = input.workflow ?? input.workflowRuntime;
  const implementation = resolveResourceImplementation(semanticType) ??
    (input.type as CloudflareManagedResourceType);

  try {
    if (backendName !== "cloudflare") {
      await ensurePortableManagedResource({
        id,
        backend_name: backendName,
        backing_resource_name: backingResourceName,
        ...(input.config ? { config: input.config } : {}),
      }, semanticType);
      const portableBackingResourceId = await resolvePortableBackendResourceId({
        id,
        semanticType,
        backendName,
        backingResourceName,
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
          backend_name: backendName,
          status: "active",
          backing_resource_id: portableBackingResourceId,
          backing_resource_name: backingResourceName,
          config: input.config || {},
          space_id: input.spaceId || null,
          group_id: input.groupId || null,
          created_at: timestamp,
          updated_at: timestamp,
        });
      }

      return {
        id,
        backingResourceId: portableBackingResourceId,
        backingResourceName,
      };
    }

    const cloudflareResources = new CloudflareResourceService(env);
    const created = await cloudflareResources.createResource(
      implementation as CloudflareManagedResourceType,
      backingResourceName,
      {
        ...(input.vectorize || input.vectorIndex
          ? { vectorize: input.vectorize ?? input.vectorIndex }
          : {}),
        ...(input.queue ? { queue: input.queue } : {}),
        ...(input.analyticsEngine || input.analyticsStore
          ? { analyticsEngine: input.analyticsEngine ?? input.analyticsStore }
          : {}),
        ...(workflow ? { workflow } : {}),
      },
    );
    const createdBackingResourceId = created.backingResourceId;
    const createdBackingResourceName = created.backingResourceName;

    if (persist) {
      await insertResource(env.DB, {
        id,
        owner_id: input.ownerId,
        name: input.name,
        type: publicType,
        semantic_type: semanticType,
        driver,
        backend_name: backendName,
        status: "active",
        backing_resource_id: createdBackingResourceId,
        backing_resource_name: createdBackingResourceName,
        config: input.config || {},
        space_id: input.spaceId || null,
        group_id: input.groupId || null,
        created_at: timestamp,
        updated_at: timestamp,
      });
    }

    return {
      id,
      backingResourceId: createdBackingResourceId,
      backingResourceName: createdBackingResourceName,
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
        backend_name: backendName,
        backing_resource_name: backingResourceName,
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
  env: Pick<Env, "CF_ACCOUNT_ID" | "CF_API_TOKEN" | "WFP_DISPATCH_NAMESPACE">,
  input: {
    type: string;
    backendName?: string | null;
    backingResourceId?: string | null;
    backingResourceName?: string | null;
  },
): Promise<void> {
  const backendName = normalizeManagedResourceBackend(
    input.backendName ?? inferDefaultManagedResourceBackend(env),
  );
  if (backendName !== "cloudflare") {
    await deletePortableManagedResource({
      id: input.backingResourceId ?? input.backingResourceName ?? input.type,
      backend_name: backendName,
      backing_resource_name: input.backingResourceName ?? undefined,
    }, input.type);
    return;
  }
  const cloudflareResources = new CloudflareResourceService(env);
  const implementation = resolveResourceImplementation(input.type) ??
    (input.type as CloudflareManagedResourceType);
  await cloudflareResources.deleteResource({
    type: implementation,
    backingResourceId: input.backingResourceId,
    backingResourceName: input.backingResourceName,
  });
}

export const provisionCloudflareResource = provisionManagedResource;
