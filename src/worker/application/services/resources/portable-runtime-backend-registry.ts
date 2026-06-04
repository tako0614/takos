import type {
  KvStoreBinding,
  ObjectStoreBinding,
} from "../../../shared/types/bindings.ts";
import type { ResourceCapability } from "../../../shared/types/index.ts";
import {
  normalizePortableResourceBackend,
  type PortableResourceBackend,
} from "./capabilities.ts";
import {
  optionalEnv,
  resolvePostgresUrl,
} from "../../../node-platform/resolvers/env-utils.ts";
import type {
  PortableResourceRef,
  PortableResourceResolution,
} from "./portable-runtime.ts";

export type PortableBackend = PortableResourceBackend;

export type PortableSecretStore = {
  getSecretValue(name: string): Promise<string>;
  ensureSecret(name: string, value: string): Promise<string | void>;
  deleteSecret(name: string): Promise<void>;
};

type PrefixedKvNamespaceFactory = (
  base: KvStoreBinding,
  prefix: string,
) => KvStoreBinding;

export type PortableQueueBackendRuntime = {
  ensure?: (resource: PortableResourceRef) => Promise<void>;
  delete?: (resource: PortableResourceRef) => Promise<void>;
  resolveReferenceId?: (resource: PortableResourceRef) => Promise<string>;
};

type PortableBackendDefinition = {
  resolutions: Partial<Record<ResourceCapability, PortableResourceResolution>>;
  missingRequirements?: Partial<Record<ResourceCapability, () => string[]>>;
  createSecretStore?: () => PortableSecretStore;
  createObjectStoreAdapter?: (
    resource: PortableResourceRef,
  ) => ObjectStoreBinding | null;
  createKvStoreAdapter?: (
    resource: PortableResourceRef,
    createPrefixedKvNamespace: PrefixedKvNamespaceFactory,
  ) => KvStoreBinding | null;
  queue?: PortableQueueBackendRuntime;
};

export function sanitizeName(name: string): string {
  const sanitized = name.replace(/[^a-zA-Z0-9._-]/g, "-").replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return sanitized || "resource";
}

export function sanitizeSqlIdentifier(name: string): string {
  return sanitizeName(name).replace(/[^a-zA-Z0-9_]/g, "_");
}

function resolvePortableQueueName(resource: PortableResourceRef): string {
  return sanitizeName(resource.backing_resource_name ?? resource.id);
}

function missingPortablePgVectorRequirements(): string[] {
  const missing: string[] = [];
  if (!resolvePostgresUrl()) {
    missing.push("POSTGRES_URL or DATABASE_URL");
  }
  if (optionalEnv("PGVECTOR_ENABLED") !== "true") {
    missing.push("PGVECTOR_ENABLED=true");
  }
  return missing;
}

// Multi-cloud materialization (aws/gcp/k8s: DynamoDB/Firestore/S3/GCS/SQS/PubSub
// secret managers) is operator-substrate scope owned by OpenTofu RunnerProfiles,
// not the Takos worker. Only the native `cloudflare` backend and the portable
// self-hosted `local` backend are provisioned in-worker.
const PORTABLE_BACKEND_REGISTRY: Record<
  PortableBackend,
  PortableBackendDefinition
> = {
  local: {
    resolutions: {
      sql: {
        mode: "takos-runtime",
        backend: "sqlite-d1-adapter",
        requirements: [],
      },
      object_store: {
        mode: "takos-runtime",
        backend: "persistent-r2-bucket",
        requirements: [],
      },
      kv: {
        mode: "takos-runtime",
        backend: "persistent-kv-namespace",
        requirements: [],
      },
      queue: {
        mode: "takos-runtime",
        backend: "persistent-queue",
        requirements: [],
      },
      vector_index: {
        mode: "takos-runtime",
        backend: "pgvector-store",
        requirements: ["POSTGRES_URL or DATABASE_URL", "PGVECTOR_ENABLED=true"],
      },
      analytics_store: {
        mode: "takos-runtime",
        backend: "analytics-engine-binding",
        requirements: [],
      },
      workflow_runtime: {
        mode: "takos-runtime",
        backend: "workflow-binding",
        requirements: [],
      },
      durable_namespace: {
        mode: "takos-runtime",
        backend: "persistent-durable-objects",
        requirements: [],
      },
      secret: {
        mode: "takos-runtime",
        backend: "local-secret-store",
        requirements: [],
      },
    },
    queue: {
      resolveReferenceId: async (resource) =>
        resolvePortableQueueName(resource),
    },
    missingRequirements: {
      vector_index: missingPortablePgVectorRequirements,
    },
  },
};

export function normalizePortableBackend(
  backendName?: string | null,
): PortableBackend {
  return normalizePortableResourceBackend(backendName);
}

export function getPortableBackendResolution(
  backend: PortableBackend,
  capability: ResourceCapability,
): PortableResourceResolution | null {
  const resolution = PORTABLE_BACKEND_REGISTRY[backend].resolutions[capability];
  if (!resolution) return null;
  return {
    ...resolution,
    requirements: [...resolution.requirements],
    ...(resolution.notes ? { notes: [...resolution.notes] } : {}),
  };
}

export function missingPortableBootstrapRequirementsForBackend(
  backend: PortableBackend,
  capability: ResourceCapability,
): string[] {
  return PORTABLE_BACKEND_REGISTRY[backend].missingRequirements
    ?.[capability]?.() ?? [];
}

export function getPortableMissingBootstrapRequirements(
  backend: PortableBackend,
  capability: ResourceCapability,
): string[] {
  return missingPortableBootstrapRequirementsForBackend(backend, capability);
}

export function getPortableSecretStore(
  backend: PortableBackend,
): PortableSecretStore | null {
  return PORTABLE_BACKEND_REGISTRY[backend].createSecretStore?.() ?? null;
}

export function resolvePortableObjectStoreCloudAdapter(
  resource: PortableResourceRef,
): ObjectStoreBinding | null {
  return PORTABLE_BACKEND_REGISTRY[
    normalizePortableBackend(resource.backend_name)
  ]
    .createObjectStoreAdapter?.(resource) ?? null;
}

export function resolvePortableKvCloudAdapter(
  resource: PortableResourceRef,
  createPrefixedKvNamespace: PrefixedKvNamespaceFactory,
): KvStoreBinding | null {
  return PORTABLE_BACKEND_REGISTRY[
    normalizePortableBackend(resource.backend_name)
  ]
    .createKvStoreAdapter?.(resource, createPrefixedKvNamespace) ?? null;
}

export async function ensurePortableBackendQueue(
  resource: PortableResourceRef,
): Promise<boolean> {
  const ensureQueue = PORTABLE_BACKEND_REGISTRY[
    normalizePortableBackend(resource.backend_name)
  ].queue?.ensure;
  if (!ensureQueue) return false;
  await ensureQueue(resource);
  return true;
}

export async function deletePortableBackendQueue(
  resource: PortableResourceRef,
): Promise<boolean> {
  const deleteQueue = PORTABLE_BACKEND_REGISTRY[
    normalizePortableBackend(resource.backend_name)
  ].queue?.delete;
  if (!deleteQueue) return false;
  await deleteQueue(resource);
  return true;
}

export async function resolvePortableQueueReferenceId(
  resource: PortableResourceRef,
): Promise<string | null> {
  const resolveReferenceId = PORTABLE_BACKEND_REGISTRY[
    normalizePortableBackend(resource.backend_name)
  ].queue?.resolveReferenceId;
  return resolveReferenceId ? await resolveReferenceId(resource) : null;
}

export function resetPortableBackendRuntimeCachesForTests(): void {
}

export function getPortableQueueBackendOps(
  backendName?: string | null,
): PortableQueueBackendRuntime {
  return PORTABLE_BACKEND_REGISTRY[normalizePortableBackend(backendName)]
    .queue ?? {};
}

export function resetPortableBackendRegistryCachesForTests(): void {
  resetPortableBackendRuntimeCachesForTests();
}
