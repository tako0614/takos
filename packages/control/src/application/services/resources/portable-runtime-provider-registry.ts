import {
  CreateQueueCommand,
  DeleteQueueCommand,
  GetQueueUrlCommand,
  SQSClient,
} from "@aws-sdk/client-sqs";
import type { PubSub } from "@google-cloud/pubsub";
import { createClient } from "redis";
import type { KVNamespace, R2Bucket } from "../../../shared/types/bindings.ts";
import type { ResourceCapability } from "../../../shared/types/index.ts";
import { createAwsSecretsStore } from "../../../adapters/aws-secrets-store.ts";
import { createDynamoKvStore } from "../../../adapters/dynamo-kv-store.ts";
import { createFirestoreKvStore } from "../../../adapters/firestore-kv-store.ts";
import { createGcsObjectStore } from "../../../adapters/gcs-object-store.ts";
import { createGcpSecretStore } from "../../../adapters/gcp-secret-store.ts";
import { createK8sSecretStore } from "../../../adapters/k8s-secret-store.ts";
import { createS3ObjectStore } from "../../../adapters/s3-object-store.ts";
import { createRedisQueue } from "../../../local-platform/redis-bindings.ts";
import {
  optionalEnv,
  resolvePostgresUrl,
  resolveRedisUrl,
} from "../../../node-platform/resolvers/env-utils.ts";
import type {
  PortableResourceRef,
  PortableResourceResolution,
} from "./portable-runtime.ts";

export type PortableProvider = "local" | "aws" | "gcp" | "k8s";

export type PortableSecretStore = {
  getSecretValue(name: string): Promise<string>;
  ensureSecret(name: string, value: string): Promise<string | void>;
  deleteSecret(name: string): Promise<void>;
};

type PrefixedKvNamespaceFactory = (
  base: KVNamespace,
  prefix: string,
) => KVNamespace;

export type PortableQueueProviderRuntime = {
  ensure?: (resource: PortableResourceRef) => Promise<void>;
  delete?: (resource: PortableResourceRef) => Promise<void>;
  resolveReferenceId?: (resource: PortableResourceRef) => Promise<string>;
};

type PortableProviderDefinition = {
  resolutions: Partial<Record<ResourceCapability, PortableResourceResolution>>;
  missingRequirements?: Partial<Record<ResourceCapability, () => string[]>>;
  createSecretStore?: () => PortableSecretStore;
  createObjectStoreAdapter?: (resource: PortableResourceRef) => R2Bucket | null;
  createKvStoreAdapter?: (
    resource: PortableResourceRef,
    createPrefixedKvNamespace: PrefixedKvNamespaceFactory,
  ) => KVNamespace | null;
  queue?: PortableQueueProviderRuntime;
};

let portablePubSubPromise: Promise<PubSub> | undefined;

export function sanitizeName(name: string): string {
  const sanitized = name.replace(/[^a-zA-Z0-9._-]/g, "-").replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return sanitized || "resource";
}

export function sanitizeSqlIdentifier(name: string): string {
  return sanitizeName(name).replace(/[^a-zA-Z0-9_]/g, "_");
}

function resolvePortableQueueName(resource: PortableResourceRef): string {
  return sanitizeName(resource.provider_resource_name ?? resource.id);
}

function resolvePortablePubSubSubscriptionName(
  resource: PortableResourceRef,
): string {
  return `${resolvePortableQueueName(resource)}-subscription`;
}

function isNotFoundError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /not found|404|NoSuchEntity|ResourceNotFound/i.test(message);
}

function missingPortablePostgresRequirements(): string[] {
  return resolvePostgresUrl() ? [] : ["POSTGRES_URL or DATABASE_URL"];
}

function missingPortablePgVectorRequirements(): string[] {
  const missing = missingPortablePostgresRequirements();
  if (optionalEnv("PGVECTOR_ENABLED") !== "true") {
    missing.push("PGVECTOR_ENABLED=true");
  }
  return missing;
}

function missingPortableK8sSecretRequirements(): string[] {
  return [
    ...(optionalEnv("K8S_API_SERVER") || Deno.env.get("KUBERNETES_SERVICE_HOST")
      ? []
      : ["K8S_API_SERVER or in-cluster Kubernetes service env"]),
    ...(optionalEnv("K8S_BEARER_TOKEN") ||
        Deno.env.get("KUBERNETES_SERVICE_HOST")
      ? []
      : ["K8S_BEARER_TOKEN or in-cluster service account token"]),
    ...(optionalEnv("K8S_NAMESPACE") || Deno.env.get("KUBERNETES_SERVICE_HOST")
      ? []
      : ["K8S_NAMESPACE or in-cluster service account namespace"]),
  ];
}

function resolveAwsRegion(): string {
  return optionalEnv("AWS_REGION") ?? "us-east-1";
}

function createPortableSqsClient(): SQSClient {
  return new SQSClient({
    region: resolveAwsRegion(),
    ...(optionalEnv("AWS_ACCESS_KEY_ID") && optionalEnv("AWS_SECRET_ACCESS_KEY")
      ? {
        credentials: {
          accessKeyId: optionalEnv("AWS_ACCESS_KEY_ID")!,
          secretAccessKey: optionalEnv("AWS_SECRET_ACCESS_KEY")!,
        },
      }
      : {}),
  });
}

async function ensurePortableAwsQueue(
  resource: PortableResourceRef,
): Promise<string> {
  const client = createPortableSqsClient();
  const queueName = resolvePortableQueueName(resource);
  const attributes: Record<string, string> = {};
  const config = resource.config && typeof resource.config === "object"
    ? resource.config as Record<string, unknown>
    : {};
  const queueConfig = config.queue && typeof config.queue === "object"
    ? config.queue as Record<string, unknown>
    : {};
  if (typeof queueConfig.deliveryDelaySeconds === "number") {
    attributes.DelaySeconds = String(
      Math.max(0, Math.floor(queueConfig.deliveryDelaySeconds)),
    );
  }
  const created = await client.send(
    new CreateQueueCommand({
      QueueName: queueName,
      ...(Object.keys(attributes).length > 0 ? { Attributes: attributes } : {}),
    }),
  );
  if (created.QueueUrl) {
    return created.QueueUrl;
  }
  const existing = await client.send(
    new GetQueueUrlCommand({ QueueName: queueName }),
  );
  if (!existing.QueueUrl) {
    throw new Error(`Unable to resolve SQS queue URL for "${queueName}"`);
  }
  return existing.QueueUrl;
}

async function deletePortableAwsQueue(
  resource: PortableResourceRef,
): Promise<void> {
  const client = createPortableSqsClient();
  const queueUrl = resource.provider_resource_id ||
    await ensurePortableAwsQueue(resource);
  await client.send(
    new DeleteQueueCommand({
      QueueUrl: queueUrl,
    }),
  );
}

async function createPortablePubSubClient(): Promise<PubSub> {
  if (!portablePubSubPromise) {
    portablePubSubPromise = (async () => {
      const { PubSub } = await import("@google-cloud/pubsub");
      return new PubSub({
        ...(optionalEnv("GCP_PROJECT_ID")
          ? { projectId: optionalEnv("GCP_PROJECT_ID") }
          : {}),
        ...(optionalEnv("GOOGLE_APPLICATION_CREDENTIALS")
          ? { keyFilename: optionalEnv("GOOGLE_APPLICATION_CREDENTIALS") }
          : {}),
      });
    })();
  }
  return portablePubSubPromise;
}

async function ensurePortableGcpQueue(
  resource: PortableResourceRef,
): Promise<string> {
  const pubsub = await createPortablePubSubClient();
  const topicName = resolvePortableQueueName(resource);
  const subscriptionName = resolvePortablePubSubSubscriptionName(resource);
  const [topic] = await pubsub.topic(topicName).get({ autoCreate: true });
  const [subscriptionExists] = await pubsub.subscription(subscriptionName)
    .exists();
  if (!subscriptionExists) {
    await topic.createSubscription(subscriptionName);
  }
  return subscriptionName;
}

async function deletePortableGcpQueue(
  resource: PortableResourceRef,
): Promise<void> {
  const pubsub = await createPortablePubSubClient();
  const topicName = resolvePortableQueueName(resource);
  const subscriptionName = resolvePortablePubSubSubscriptionName(resource);
  try {
    await pubsub.subscription(subscriptionName).delete();
  } catch (error) {
    if (!isNotFoundError(error)) {
      throw error;
    }
  }
  try {
    await pubsub.topic(topicName).delete();
  } catch (error) {
    if (!isNotFoundError(error)) {
      throw error;
    }
  }
}

async function clearPortableRedisQueue(
  resource: PortableResourceRef,
): Promise<void> {
  const redisUrl = resolveRedisUrl();
  if (!redisUrl) return;
  const client = await createClient({ url: redisUrl }).connect();
  try {
    await client.del(`takos:local:queue:${resolvePortableQueueName(resource)}`);
  } finally {
    await client.close().catch(() => undefined);
  }
}

const PORTABLE_PROVIDER_REGISTRY: Record<
  PortableProvider,
  PortableProviderDefinition
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
  },
  aws: {
    resolutions: {
      sql: {
        mode: "provider-backed",
        backend: "postgres-schema-d1-adapter",
        requirements: ["POSTGRES_URL or DATABASE_URL"],
      },
      object_store: {
        mode: "provider-backed",
        backend: "s3-object-store",
        requirements: [],
      },
      kv: {
        mode: "provider-backed",
        backend: "dynamo-kv-store",
        requirements: [
          "AWS_DYNAMO_KV_TABLE or AWS_DYNAMO_HOSTNAME_ROUTING_TABLE",
        ],
      },
      queue: {
        mode: "provider-backed",
        backend: "sqs-queue",
        requirements: [],
      },
      vector_index: {
        mode: "provider-backed",
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
        mode: "provider-backed",
        backend: "aws-secrets-manager",
        requirements: [],
      },
    },
    missingRequirements: {
      sql: missingPortablePostgresRequirements,
      kv: () =>
        optionalEnv("AWS_DYNAMO_KV_TABLE") ||
          optionalEnv("AWS_DYNAMO_HOSTNAME_ROUTING_TABLE")
          ? []
          : ["AWS_DYNAMO_KV_TABLE or AWS_DYNAMO_HOSTNAME_ROUTING_TABLE"],
      vector_index: missingPortablePgVectorRequirements,
    },
    createSecretStore: () =>
      createAwsSecretsStore({
        region: resolveAwsRegion(),
        accessKeyId: optionalEnv("AWS_ACCESS_KEY_ID"),
        secretAccessKey: optionalEnv("AWS_SECRET_ACCESS_KEY"),
      }),
    createObjectStoreAdapter: (resource) => {
      const bucketName = resource.provider_resource_name;
      if (!bucketName) return null;
      return createS3ObjectStore({
        region: resolveAwsRegion(),
        bucket: bucketName,
        accessKeyId: optionalEnv("AWS_ACCESS_KEY_ID"),
        secretAccessKey: optionalEnv("AWS_SECRET_ACCESS_KEY"),
        endpoint: optionalEnv("AWS_S3_ENDPOINT"),
      });
    },
    createKvStoreAdapter: (resource, createPrefixedKvNamespace) => {
      const tableName = optionalEnv("AWS_DYNAMO_KV_TABLE") ??
        optionalEnv("AWS_DYNAMO_HOSTNAME_ROUTING_TABLE");
      if (!tableName) return null;
      const base = createDynamoKvStore({
        region: resolveAwsRegion(),
        tableName,
        accessKeyId: optionalEnv("AWS_ACCESS_KEY_ID"),
        secretAccessKey: optionalEnv("AWS_SECRET_ACCESS_KEY"),
      });
      return createPrefixedKvNamespace(
        base,
        sanitizeName(resource.provider_resource_name ?? resource.id),
      );
    },
    queue: {
      ensure: async (resource) => {
        await ensurePortableAwsQueue(resource);
      },
      delete: deletePortableAwsQueue,
      resolveReferenceId: ensurePortableAwsQueue,
    },
  },
  gcp: {
    resolutions: {
      sql: {
        mode: "provider-backed",
        backend: "postgres-schema-d1-adapter",
        requirements: ["POSTGRES_URL or DATABASE_URL"],
      },
      object_store: {
        mode: "provider-backed",
        backend: "gcs-object-store",
        requirements: [],
      },
      kv: {
        mode: "provider-backed",
        backend: "firestore-kv-store",
        requirements: ["GCP_FIRESTORE_KV_COLLECTION"],
      },
      queue: {
        mode: "provider-backed",
        backend: "pubsub-queue",
        requirements: [],
      },
      vector_index: {
        mode: "provider-backed",
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
        mode: "provider-backed",
        backend: "gcp-secret-manager",
        requirements: [],
      },
    },
    missingRequirements: {
      sql: missingPortablePostgresRequirements,
      kv: () =>
        optionalEnv("GCP_FIRESTORE_KV_COLLECTION")
          ? []
          : ["GCP_FIRESTORE_KV_COLLECTION"],
      vector_index: missingPortablePgVectorRequirements,
    },
    createSecretStore: () =>
      createGcpSecretStore({
        projectId: optionalEnv("GCP_PROJECT_ID"),
        keyFilePath: optionalEnv("GOOGLE_APPLICATION_CREDENTIALS"),
      }),
    createObjectStoreAdapter: (resource) => {
      const bucketName = resource.provider_resource_name;
      if (!bucketName) return null;
      return createGcsObjectStore({
        bucket: bucketName,
        projectId: optionalEnv("GCP_PROJECT_ID"),
        keyFilePath: optionalEnv("GOOGLE_APPLICATION_CREDENTIALS"),
      });
    },
    createKvStoreAdapter: (resource, createPrefixedKvNamespace) => {
      const collectionName = optionalEnv("GCP_FIRESTORE_KV_COLLECTION");
      if (!collectionName) return null;
      const base = createFirestoreKvStore({
        projectId: optionalEnv("GCP_PROJECT_ID"),
        keyFilePath: optionalEnv("GOOGLE_APPLICATION_CREDENTIALS"),
        collectionName,
      });
      return createPrefixedKvNamespace(
        base,
        sanitizeName(resource.provider_resource_name ?? resource.id),
      );
    },
    queue: {
      ensure: async (resource) => {
        await ensurePortableGcpQueue(resource);
      },
      delete: deletePortableGcpQueue,
      resolveReferenceId: async (resource) =>
        await ensurePortableGcpQueue(resource),
    },
  },
  k8s: {
    resolutions: {
      sql: {
        mode: "provider-backed",
        backend: "postgres-schema-d1-adapter",
        requirements: ["POSTGRES_URL or DATABASE_URL"],
      },
      object_store: {
        mode: "provider-backed",
        backend: "s3-compatible-object-store",
        requirements: [],
      },
      kv: {
        mode: "takos-runtime",
        backend: "persistent-kv-namespace",
        requirements: [],
      },
      queue: {
        mode: "provider-backed",
        backend: "redis-queue",
        requirements: ["REDIS_URL"],
      },
      vector_index: {
        mode: "provider-backed",
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
        mode: "provider-backed",
        backend: "k8s-secret",
        requirements: [
          "K8S_API_SERVER or in-cluster Kubernetes service env",
          "K8S_BEARER_TOKEN or in-cluster service account token",
          "K8S_NAMESPACE or in-cluster service account namespace",
        ],
      },
    },
    missingRequirements: {
      sql: missingPortablePostgresRequirements,
      queue: () => resolveRedisUrl() ? [] : ["REDIS_URL"],
      vector_index: missingPortablePgVectorRequirements,
      secret: missingPortableK8sSecretRequirements,
    },
    createSecretStore: () =>
      createK8sSecretStore({
        apiServer: optionalEnv("K8S_API_SERVER"),
        namespace: optionalEnv("K8S_NAMESPACE"),
        bearerToken: optionalEnv("K8S_BEARER_TOKEN"),
        caFilePath: optionalEnv("K8S_CA_CERT_FILE"),
      }),
    createObjectStoreAdapter: (resource) => {
      const bucketName = resource.provider_resource_name;
      if (!bucketName) return null;
      return createS3ObjectStore({
        region: resolveAwsRegion(),
        bucket: bucketName,
        accessKeyId: optionalEnv("AWS_ACCESS_KEY_ID"),
        secretAccessKey: optionalEnv("AWS_SECRET_ACCESS_KEY"),
        endpoint: optionalEnv("AWS_S3_ENDPOINT"),
      });
    },
    queue: {
      ensure: async (resource) => {
        createRedisQueue(
          resolveRedisUrl()!,
          resolvePortableQueueName(resource),
        );
      },
      delete: clearPortableRedisQueue,
      resolveReferenceId: async (resource) =>
        resolvePortableQueueName(resource),
    },
  },
};

export function normalizePortableProvider(
  providerName?: string | null,
): PortableProvider {
  switch (providerName) {
    case "aws":
    case "gcp":
    case "k8s":
      return providerName;
    case "local":
    default:
      return "local";
  }
}

export function getPortableProviderResolution(
  provider: PortableProvider,
  capability: ResourceCapability,
): PortableResourceResolution | null {
  const resolution =
    PORTABLE_PROVIDER_REGISTRY[provider].resolutions[capability];
  if (!resolution) return null;
  return {
    ...resolution,
    requirements: [...resolution.requirements],
    ...(resolution.notes ? { notes: [...resolution.notes] } : {}),
  };
}

export function missingPortableBootstrapRequirementsForProvider(
  provider: PortableProvider,
  capability: ResourceCapability,
): string[] {
  return PORTABLE_PROVIDER_REGISTRY[provider].missingRequirements
    ?.[capability]?.() ?? [];
}

export function getPortableMissingBootstrapRequirements(
  provider: PortableProvider,
  capability: ResourceCapability,
): string[] {
  return missingPortableBootstrapRequirementsForProvider(provider, capability);
}

export function getPortableSecretStore(
  provider: PortableProvider,
): PortableSecretStore | null {
  return PORTABLE_PROVIDER_REGISTRY[provider].createSecretStore?.() ?? null;
}

export function resolvePortableObjectStoreCloudAdapter(
  resource: PortableResourceRef,
): R2Bucket | null {
  return PORTABLE_PROVIDER_REGISTRY[
    normalizePortableProvider(resource.provider_name)
  ]
    .createObjectStoreAdapter?.(resource) ?? null;
}

export function resolvePortableKvCloudAdapter(
  resource: PortableResourceRef,
  createPrefixedKvNamespace: PrefixedKvNamespaceFactory,
): KVNamespace | null {
  return PORTABLE_PROVIDER_REGISTRY[
    normalizePortableProvider(resource.provider_name)
  ]
    .createKvStoreAdapter?.(resource, createPrefixedKvNamespace) ?? null;
}

export async function ensurePortableProviderQueue(
  resource: PortableResourceRef,
): Promise<boolean> {
  const ensureQueue = PORTABLE_PROVIDER_REGISTRY[
    normalizePortableProvider(resource.provider_name)
  ].queue?.ensure;
  if (!ensureQueue) return false;
  await ensureQueue(resource);
  return true;
}

export async function deletePortableProviderQueue(
  resource: PortableResourceRef,
): Promise<boolean> {
  const deleteQueue = PORTABLE_PROVIDER_REGISTRY[
    normalizePortableProvider(resource.provider_name)
  ].queue?.delete;
  if (!deleteQueue) return false;
  await deleteQueue(resource);
  return true;
}

export async function resolvePortableQueueReferenceId(
  resource: PortableResourceRef,
): Promise<string | null> {
  const resolveReferenceId = PORTABLE_PROVIDER_REGISTRY[
    normalizePortableProvider(resource.provider_name)
  ].queue?.resolveReferenceId;
  return resolveReferenceId ? await resolveReferenceId(resource) : null;
}

export function resetPortableProviderRuntimeCachesForTests(): void {
  portablePubSubPromise = undefined;
}

export function getPortableQueueProviderOps(
  providerName?: string | null,
): PortableQueueProviderRuntime {
  return PORTABLE_PROVIDER_REGISTRY[normalizePortableProvider(providerName)]
    .queue ?? {};
}

export function resetPortableProviderRegistryCachesForTests(): void {
  resetPortableProviderRuntimeCachesForTests();
}
