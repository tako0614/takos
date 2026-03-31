import { rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CreateQueueCommand, DeleteQueueCommand, GetQueueUrlCommand, SQSClient } from '@aws-sdk/client-sqs';
import { PubSub } from '@google-cloud/pubsub';
import { Pool } from 'pg';
import { createClient } from 'redis';
import type { D1Database, KVNamespace, R2Bucket } from '../../../shared/types/bindings.ts';
import type { ResourceCapability } from '../../../shared/types';
import { createAwsSecretsStore } from '../../../adapters/aws-secrets-store.ts';
import { createDynamoKvStore } from '../../../adapters/dynamo-kv-store.ts';
import { createFirestoreKvStore } from '../../../adapters/firestore-kv-store.ts';
import { createGcsObjectStore } from '../../../adapters/gcs-object-store.ts';
import { createGcpSecretStore } from '../../../adapters/gcp-secret-store.ts';
import { createK8sSecretStore } from '../../../adapters/k8s-secret-store.ts';
import { createS3ObjectStore } from '../../../adapters/s3-object-store.ts';
import {
  createPersistentKVNamespace,
  createPersistentR2Bucket,
  createSchemaScopedPostgresD1Database,
  createSqliteD1Database,
} from '../../../local-platform/persistent-bindings.ts';
import { createRedisQueue } from '../../../local-platform/redis-bindings.ts';
import { readJsonFile, writeJsonFile } from '../../../local-platform/persistent-shared.ts';
import { optionalEnv, resolveLocalDataDir, resolvePostgresUrl, resolveRedisUrl } from '../../../node-platform/resolvers/env-utils.ts';
import { toResourceCapability } from './capabilities.ts';

export type PortableResourceRef = {
  id: string;
  provider_name?: string | null;
  provider_resource_id?: string | null;
  provider_resource_name?: string | null;
  config?: unknown;
};

export type PortableResourceResolutionMode = 'provider-backed' | 'takos-runtime';

export type PortableResourceResolution = {
  mode: PortableResourceResolutionMode;
  backend: string;
  requirements: string[];
  notes?: string[];
};

const sqlCache = new Map<string, Promise<D1Database>>();
const objectStoreCache = new Map<string, R2Bucket>();
const kvStoreCache = new Map<string, KVNamespace>();

function normalizePortableProvider(providerName?: string | null): 'local' | 'aws' | 'gcp' | 'k8s' {
  switch (providerName) {
    case 'aws':
    case 'gcp':
    case 'k8s':
      return providerName;
    case 'local':
    default:
      return 'local';
  }
}

function sanitizeName(name: string): string {
  const sanitized = name.replace(/[^a-zA-Z0-9._-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
  return sanitized || 'resource';
}

function sanitizeSqlIdentifier(name: string): string {
  return sanitizeName(name).replace(/[^a-zA-Z0-9_]/g, '_');
}

function resolvePortableDataDir(): string {
  return resolveLocalDataDir() ?? path.join(os.tmpdir(), 'takos-portable-data');
}

function resourceCacheKey(resource: PortableResourceRef): string {
  return `${resource.provider_name ?? 'portable'}:${resource.id}:${resource.provider_resource_name ?? ''}`;
}

function resolveResourceBasePath(
  kind:
    | 'sql'
    | 'object-store'
    | 'kv'
    | 'queue'
    | 'vector-index'
    | 'analytics-store'
    | 'workflow-runtime'
    | 'durable-namespace'
    | 'secret',
  resource: PortableResourceRef,
): string {
  const baseDir = resolvePortableDataDir();
  const fileBase = sanitizeName(resource.provider_resource_name ?? resource.id);
  return path.join(baseDir, 'managed-resources', kind, fileBase);
}

function resolveControlMigrationsDir(): string {
  return path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '..',
    '..',
    '..',
    '..',
    'db',
    'migrations',
  );
}

function resolvePortableSqlSchemaName(resource: PortableResourceRef): string {
  return `resource_${sanitizeSqlIdentifier(resource.provider_resource_name ?? resource.id)}`;
}

function resolvePortableVectorTableName(resource: PortableResourceRef): string {
  return `vector_${sanitizeSqlIdentifier(resource.provider_resource_name ?? resource.id)}`;
}

function usesPortablePostgres(resource: PortableResourceRef): boolean {
  return !!resolvePostgresUrl()
    && !!resource.provider_name
    && resource.provider_name !== 'cloudflare'
    && resource.provider_name !== 'local';
}

function resolvePortableQueueName(resource: PortableResourceRef): string {
  return sanitizeName(resource.provider_resource_name ?? resource.id);
}

function resolvePortablePubSubSubscriptionName(resource: PortableResourceRef): string {
  return `${resolvePortableQueueName(resource)}-subscription`;
}

function isNotFoundError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /not found|404|NoSuchEntity|ResourceNotFound/i.test(message);
}

export function describePortableResourceResolution(
  providerName?: string | null,
  typeOrCapability?: string | null,
): PortableResourceResolution | null {
  const capability = resourceCapability(typeOrCapability);
  if (!capability) return null;

  const provider = normalizePortableProvider(providerName);

  switch (provider) {
    case 'local':
      switch (capability) {
        case 'sql':
          return { mode: 'takos-runtime', backend: 'sqlite-d1-adapter', requirements: [] };
        case 'object_store':
          return { mode: 'takos-runtime', backend: 'persistent-r2-bucket', requirements: [] };
        case 'kv':
          return { mode: 'takos-runtime', backend: 'persistent-kv-namespace', requirements: [] };
        case 'queue':
          return { mode: 'takos-runtime', backend: 'persistent-queue', requirements: [] };
        case 'vector_index':
          return {
            mode: 'takos-runtime',
            backend: 'pgvector-store',
            requirements: ['POSTGRES_URL or DATABASE_URL', 'PGVECTOR_ENABLED=true'],
          };
        case 'analytics_store':
          return { mode: 'takos-runtime', backend: 'analytics-engine-binding', requirements: [] };
        case 'workflow_runtime':
          return { mode: 'takos-runtime', backend: 'workflow-binding', requirements: [] };
        case 'durable_namespace':
          return { mode: 'takos-runtime', backend: 'persistent-durable-objects', requirements: [] };
        case 'secret':
          return { mode: 'takos-runtime', backend: 'local-secret-store', requirements: [] };
      }
      break;
    case 'aws':
      switch (capability) {
        case 'sql':
          return { mode: 'provider-backed', backend: 'postgres-schema-d1-adapter', requirements: ['POSTGRES_URL or DATABASE_URL'] };
        case 'object_store':
          return { mode: 'provider-backed', backend: 's3-object-store', requirements: [] };
        case 'kv':
          return {
            mode: 'provider-backed',
            backend: 'dynamo-kv-store',
            requirements: ['AWS_DYNAMO_KV_TABLE or AWS_DYNAMO_HOSTNAME_ROUTING_TABLE'],
          };
        case 'queue':
          return { mode: 'provider-backed', backend: 'sqs-queue', requirements: [] };
        case 'vector_index':
          return {
            mode: 'provider-backed',
            backend: 'pgvector-store',
            requirements: ['POSTGRES_URL or DATABASE_URL', 'PGVECTOR_ENABLED=true'],
          };
        case 'analytics_store':
          return { mode: 'takos-runtime', backend: 'analytics-engine-binding', requirements: [] };
        case 'workflow_runtime':
          return { mode: 'takos-runtime', backend: 'workflow-binding', requirements: [] };
        case 'durable_namespace':
          return { mode: 'takos-runtime', backend: 'persistent-durable-objects', requirements: [] };
        case 'secret':
          return { mode: 'provider-backed', backend: 'aws-secrets-manager', requirements: [] };
      }
      break;
    case 'gcp':
      switch (capability) {
        case 'sql':
          return { mode: 'provider-backed', backend: 'postgres-schema-d1-adapter', requirements: ['POSTGRES_URL or DATABASE_URL'] };
        case 'object_store':
          return { mode: 'provider-backed', backend: 'gcs-object-store', requirements: [] };
        case 'kv':
          return {
            mode: 'provider-backed',
            backend: 'firestore-kv-store',
            requirements: ['GCP_FIRESTORE_KV_COLLECTION'],
          };
        case 'queue':
          return { mode: 'provider-backed', backend: 'pubsub-queue', requirements: [] };
        case 'vector_index':
          return {
            mode: 'provider-backed',
            backend: 'pgvector-store',
            requirements: ['POSTGRES_URL or DATABASE_URL', 'PGVECTOR_ENABLED=true'],
          };
        case 'analytics_store':
          return { mode: 'takos-runtime', backend: 'analytics-engine-binding', requirements: [] };
        case 'workflow_runtime':
          return { mode: 'takos-runtime', backend: 'workflow-binding', requirements: [] };
        case 'durable_namespace':
          return { mode: 'takos-runtime', backend: 'persistent-durable-objects', requirements: [] };
        case 'secret':
          return { mode: 'provider-backed', backend: 'gcp-secret-manager', requirements: [] };
      }
      break;
    case 'k8s':
      switch (capability) {
        case 'sql':
          return { mode: 'provider-backed', backend: 'postgres-schema-d1-adapter', requirements: ['POSTGRES_URL or DATABASE_URL'] };
        case 'object_store':
          return { mode: 'provider-backed', backend: 's3-compatible-object-store', requirements: [] };
        case 'kv':
          return { mode: 'takos-runtime', backend: 'persistent-kv-namespace', requirements: [] };
        case 'queue':
          return { mode: 'provider-backed', backend: 'redis-queue', requirements: ['REDIS_URL'] };
        case 'vector_index':
          return {
            mode: 'provider-backed',
            backend: 'pgvector-store',
            requirements: ['POSTGRES_URL or DATABASE_URL', 'PGVECTOR_ENABLED=true'],
          };
        case 'analytics_store':
          return { mode: 'takos-runtime', backend: 'analytics-engine-binding', requirements: [] };
        case 'workflow_runtime':
          return { mode: 'takos-runtime', backend: 'workflow-binding', requirements: [] };
        case 'durable_namespace':
          return { mode: 'takos-runtime', backend: 'persistent-durable-objects', requirements: [] };
        case 'secret':
          return {
            mode: 'provider-backed',
            backend: 'k8s-secret',
            requirements: ['K8S_API_SERVER or in-cluster Kubernetes service env', 'K8S_BEARER_TOKEN or in-cluster service account token', 'K8S_NAMESPACE or in-cluster service account namespace'],
          };
      }
      break;
  }

  return null;
}

async function removePath(filePath: string): Promise<void> {
  await rm(filePath, { force: true });
}

async function ensureJsonStateFile<T>(filePath: string, initialValue: T): Promise<void> {
  const missing = Symbol('missing');
  const current = await readJsonFile<T | typeof missing>(filePath, missing);
  if (current === missing) {
    await writeJsonFile(filePath, initialValue);
  }
}

async function dropPortableSqlSchema(schemaName: string): Promise<void> {
  const postgresUrl = resolvePostgresUrl();
  if (!postgresUrl) return;

  const pool = new Pool({ connectionString: postgresUrl });
  try {
    const quotedSchema = `"${schemaName.replace(/"/g, '""')}"`;
    await pool.query(`DROP SCHEMA IF EXISTS ${quotedSchema} CASCADE`);
  } finally {
    await pool.end();
  }
}

function missingPortableBootstrapRequirements(
  resource: PortableResourceRef,
  capability: ResourceCapability,
): string[] {
  const provider = normalizePortableProvider(resource.provider_name);

  switch (capability) {
    case 'sql':
      return provider !== 'local' && !resolvePostgresUrl()
        ? ['POSTGRES_URL or DATABASE_URL']
        : [];
    case 'kv':
      if (provider === 'aws') {
        return optionalEnv('AWS_DYNAMO_KV_TABLE') || optionalEnv('AWS_DYNAMO_HOSTNAME_ROUTING_TABLE')
          ? []
          : ['AWS_DYNAMO_KV_TABLE or AWS_DYNAMO_HOSTNAME_ROUTING_TABLE'];
      }
      if (provider === 'gcp') {
        return optionalEnv('GCP_FIRESTORE_KV_COLLECTION')
          ? []
          : ['GCP_FIRESTORE_KV_COLLECTION'];
      }
      return [];
    case 'queue':
      if (provider === 'k8s' && !resolveRedisUrl()) {
        return ['REDIS_URL'];
      }
      return [];
    case 'vector_index': {
      const missing: string[] = [];
      if (!resolvePostgresUrl()) missing.push('POSTGRES_URL or DATABASE_URL');
      if (optionalEnv('PGVECTOR_ENABLED') !== 'true') missing.push('PGVECTOR_ENABLED=true');
      return missing;
    }
    case 'secret':
      if (provider !== 'k8s') return [];
      return [
        ...(optionalEnv('K8S_API_SERVER') || process.env.KUBERNETES_SERVICE_HOST ? [] : ['K8S_API_SERVER or in-cluster Kubernetes service env']),
        ...(optionalEnv('K8S_BEARER_TOKEN') || process.env.KUBERNETES_SERVICE_HOST ? [] : ['K8S_BEARER_TOKEN or in-cluster service account token']),
        ...(optionalEnv('K8S_NAMESPACE') || process.env.KUBERNETES_SERVICE_HOST ? [] : ['K8S_NAMESPACE or in-cluster service account namespace']),
      ];
    default:
      return [];
  }
}

function assertPortableBootstrapRequirements(
  resource: PortableResourceRef,
  capability: ResourceCapability,
): void {
  const missing = missingPortableBootstrapRequirements(resource, capability);
  if (missing.length === 0) return;

  const resolution = describePortableResourceResolution(resource.provider_name, capability);
  const provider = normalizePortableProvider(resource.provider_name);
  throw new Error(
    `${provider} ${capability} requires ${missing.join(', ')}`
      + (resolution ? ` (${resolution.backend})` : ''),
  );
}

async function ensurePortableVectorStore(resource: PortableResourceRef): Promise<void> {
  assertPortableBootstrapRequirements(resource, 'vector_index');

  const postgresUrl = resolvePostgresUrl();
  if (!postgresUrl) return;

  const pool = new Pool({ connectionString: postgresUrl });
  try {
    const tableName = `"${resolvePortableVectorTableName(resource).replace(/"/g, '""')}"`;
    await pool.query('CREATE EXTENSION IF NOT EXISTS vector');
    await pool.query(`
      CREATE TABLE IF NOT EXISTS ${tableName} (
        id TEXT PRIMARY KEY,
        embedding vector,
        metadata JSONB NOT NULL DEFAULT '{}'::jsonb
      )
    `);
  } finally {
    await pool.end();
  }
}

async function dropPortableVectorStore(resource: PortableResourceRef): Promise<void> {
  const postgresUrl = resolvePostgresUrl();
  if (!postgresUrl) return;

  const pool = new Pool({ connectionString: postgresUrl });
  try {
    const tableName = `"${resolvePortableVectorTableName(resource).replace(/"/g, '""')}"`;
    await pool.query(`DROP TABLE IF EXISTS ${tableName}`);
  } finally {
    await pool.end();
  }
}

function resolveAwsRegion(): string {
  return optionalEnv('AWS_REGION') ?? 'us-east-1';
}

function createPortableSqsClient(): SQSClient {
  return new SQSClient({
    region: resolveAwsRegion(),
    ...(optionalEnv('AWS_ACCESS_KEY_ID') && optionalEnv('AWS_SECRET_ACCESS_KEY')
      ? {
          credentials: {
            accessKeyId: optionalEnv('AWS_ACCESS_KEY_ID')!,
            secretAccessKey: optionalEnv('AWS_SECRET_ACCESS_KEY')!,
          },
        }
      : {}),
  });
}

async function ensurePortableAwsQueue(resource: PortableResourceRef): Promise<string> {
  const client = createPortableSqsClient();
  const queueName = resolvePortableQueueName(resource);
  const attributes: Record<string, string> = {};
  const config = resource.config && typeof resource.config === 'object'
    ? resource.config as Record<string, unknown>
    : {};
  const queueConfig = config.queue && typeof config.queue === 'object'
    ? config.queue as Record<string, unknown>
    : {};
  if (typeof queueConfig.deliveryDelaySeconds === 'number') {
    attributes.DelaySeconds = String(Math.max(0, Math.floor(queueConfig.deliveryDelaySeconds)));
  }
  const created = await client.send(new CreateQueueCommand({
    QueueName: queueName,
    ...(Object.keys(attributes).length > 0 ? { Attributes: attributes } : {}),
  }));
  if (created.QueueUrl) {
    return created.QueueUrl;
  }
  const existing = await client.send(new GetQueueUrlCommand({ QueueName: queueName }));
  if (!existing.QueueUrl) {
    throw new Error(`Unable to resolve SQS queue URL for "${queueName}"`);
  }
  return existing.QueueUrl;
}

async function deletePortableAwsQueue(resource: PortableResourceRef): Promise<void> {
  const client = createPortableSqsClient();
  const queueUrl = resource.provider_resource_id || await ensurePortableAwsQueue(resource);
  await client.send(new DeleteQueueCommand({
    QueueUrl: queueUrl,
  }));
}

function createPortablePubSubClient(): PubSub {
  return new PubSub({
    ...(optionalEnv('GCP_PROJECT_ID') ? { projectId: optionalEnv('GCP_PROJECT_ID') } : {}),
    ...(optionalEnv('GOOGLE_APPLICATION_CREDENTIALS')
      ? { keyFilename: optionalEnv('GOOGLE_APPLICATION_CREDENTIALS') }
      : {}),
  });
}

async function ensurePortableGcpQueue(resource: PortableResourceRef): Promise<string> {
  const pubsub = createPortablePubSubClient();
  const topicName = resolvePortableQueueName(resource);
  const subscriptionName = resolvePortablePubSubSubscriptionName(resource);
  const [topic] = await pubsub.topic(topicName).get({ autoCreate: true });
  const [subscriptionExists] = await pubsub.subscription(subscriptionName).exists();
  if (!subscriptionExists) {
    await topic.createSubscription(subscriptionName);
  }
  return subscriptionName;
}

async function deletePortableGcpQueue(resource: PortableResourceRef): Promise<void> {
  const pubsub = createPortablePubSubClient();
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

async function clearPortableRedisQueue(resource: PortableResourceRef): Promise<void> {
  const redisUrl = resolveRedisUrl();
  if (!redisUrl) return;
  const client = await createClient({ url: redisUrl }).connect();
  try {
    await client.del(`takos:local:queue:${resolvePortableQueueName(resource)}`);
  } finally {
    await client.close().catch(() => undefined);
  }
}

async function ensurePortableProviderSecret(resource: PortableResourceRef): Promise<string> {
  const secretName = sanitizeName(resource.provider_resource_name ?? resource.id);
  const generatedValue = generateSecretToken();

  switch (normalizePortableProvider(resource.provider_name)) {
    case 'aws': {
      const store = createAwsSecretsStore({
        region: resolveAwsRegion(),
        accessKeyId: optionalEnv('AWS_ACCESS_KEY_ID'),
        secretAccessKey: optionalEnv('AWS_SECRET_ACCESS_KEY'),
      });
      try {
        await store.getSecretValue(secretName);
      } catch (error) {
        if (!isNotFoundError(error)) throw error;
        await store.ensureSecret(secretName, generatedValue);
      }
      return secretName;
    }
    case 'gcp': {
      const store = createGcpSecretStore({
        projectId: optionalEnv('GCP_PROJECT_ID'),
        keyFilePath: optionalEnv('GOOGLE_APPLICATION_CREDENTIALS'),
      });
      try {
        await store.getSecretValue(secretName);
      } catch (error) {
        if (!isNotFoundError(error)) throw error;
        await store.ensureSecret(secretName, generatedValue);
      }
      return secretName;
    }
    case 'k8s': {
      const store = createK8sSecretStore({
        apiServer: optionalEnv('K8S_API_SERVER'),
        namespace: optionalEnv('K8S_NAMESPACE'),
        bearerToken: optionalEnv('K8S_BEARER_TOKEN'),
        caFilePath: optionalEnv('K8S_CA_CERT_FILE'),
      });
      try {
        await store.getSecretValue(secretName);
      } catch (error) {
        if (!isNotFoundError(error)) throw error;
        await store.ensureSecret(secretName, generatedValue);
      }
      return secretName;
    }
    default:
      return secretName;
  }
}

export async function resolvePortableResourceReferenceId(
  resource: PortableResourceRef,
  capability: ResourceCapability,
): Promise<string | null> {
  switch (capability) {
    case 'queue':
      switch (normalizePortableProvider(resource.provider_name)) {
        case 'aws':
          return ensurePortableAwsQueue(resource);
        case 'gcp':
          return resolvePortablePubSubSubscriptionName(resource);
        case 'k8s':
        case 'local':
          return resolvePortableQueueName(resource);
      }
      return null;
    case 'secret':
      return ensurePortableProviderSecret(resource);
    default:
      return null;
  }
}

function markerFilePath(kind: string, resource: PortableResourceRef): string {
  switch (kind) {
    case 'vector-index':
      return `${resolveResourceBasePath('vector-index', resource)}.json`;
    case 'analytics-store':
      return `${resolveResourceBasePath('analytics-store', resource)}.json`;
    case 'workflow-runtime':
      return `${resolveResourceBasePath('workflow-runtime', resource)}.json`;
    case 'durable-namespace':
      return `${resolveResourceBasePath('durable-namespace', resource)}.json`;
    case 'secret':
      return `${resolveResourceBasePath('secret', resource)}.json`;
    default:
      return `${resolveResourceBasePath('secret', resource)}-${sanitizeName(kind)}.json`;
  }
}

function generateSecretToken(bytes = 32): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return Array.from(buf).map((b) => b.toString(16).padStart(2, '0')).join('');
}

function markerPayload(kind: string, resource: PortableResourceRef): Record<string, unknown> {
  const base = {
    kind,
    resourceId: resource.id,
    providerName: resource.provider_name ?? null,
    providerResourceName: resource.provider_resource_name ?? null,
  };

  switch (kind) {
    case 'vector-index':
      return {
        ...base,
        vectors: {},
      };
    case 'analytics-store':
      return {
        ...base,
        dataset: resource.provider_resource_name ?? resource.id,
        datapoints: [],
      };
    case 'workflow-runtime':
      return {
        ...base,
        workflowName: resource.provider_resource_name ?? resource.id,
        instances: {},
      };
    case 'durable-namespace':
      return {
        ...base,
        namespaces: {},
      };
    case 'secret':
      return {
        ...base,
        value: generateSecretToken(),
      };
    default:
      return base;
  }
}

function markerKindForCapability(capability: ResourceCapability): string {
  switch (capability) {
    case 'vector_index':
      return 'vector-index';
    case 'analytics_store':
      return 'analytics-store';
    case 'workflow_runtime':
      return 'workflow-runtime';
    case 'durable_namespace':
      return 'durable-namespace';
    case 'secret':
      return 'secret';
    default:
      return capability;
  }
}

export async function getPortableSecretValue(resource: PortableResourceRef): Promise<string> {
  switch (normalizePortableProvider(resource.provider_name)) {
    case 'aws': {
      const store = createAwsSecretsStore({
        region: resolveAwsRegion(),
        accessKeyId: optionalEnv('AWS_ACCESS_KEY_ID'),
        secretAccessKey: optionalEnv('AWS_SECRET_ACCESS_KEY'),
      });
      return store.getSecretValue(sanitizeName(resource.provider_resource_name ?? resource.id));
    }
    case 'gcp': {
      const store = createGcpSecretStore({
        projectId: optionalEnv('GCP_PROJECT_ID'),
        keyFilePath: optionalEnv('GOOGLE_APPLICATION_CREDENTIALS'),
      });
      return store.getSecretValue(sanitizeName(resource.provider_resource_name ?? resource.id));
    }
    case 'k8s': {
      const store = createK8sSecretStore({
        apiServer: optionalEnv('K8S_API_SERVER'),
        namespace: optionalEnv('K8S_NAMESPACE'),
        bearerToken: optionalEnv('K8S_BEARER_TOKEN'),
        caFilePath: optionalEnv('K8S_CA_CERT_FILE'),
      });
      return store.getSecretValue(sanitizeName(resource.provider_resource_name ?? resource.id));
    }
    default:
      break;
  }

  const secretPath = markerFilePath('secret', resource);
  const existing = await readJsonFile<Record<string, unknown> | null>(secretPath, null);
  if (typeof existing?.value === 'string' && existing.value.length > 0) {
    return existing.value;
  }

  const payload = markerPayload('secret', resource);
  await writeJsonFile(secretPath, payload);
  return payload.value as string;
}

export function isPortableResourceProvider(providerName?: string | null): boolean {
  return !!providerName && providerName !== 'cloudflare';
}

export async function getPortableSqlDatabase(resource: PortableResourceRef): Promise<D1Database> {
  const key = resourceCacheKey(resource);
  const existing = sqlCache.get(key);
  if (existing) return existing;

  const postgresUrl = resolvePostgresUrl();
  if (resource.provider_name && resource.provider_name !== 'cloudflare' && resource.provider_name !== 'local' && !postgresUrl) {
    throw new Error(
      `${resource.provider_name} sql requires POSTGRES_URL or DATABASE_URL (postgres-schema-d1-adapter)`,
    );
  }
  const created = usesPortablePostgres(resource)
    ? createSchemaScopedPostgresD1Database(
        postgresUrl!,
        resolvePortableSqlSchemaName(resource),
      )
    : createSqliteD1Database(
        `${resolveResourceBasePath('sql', resource)}.sqlite`,
        resolveControlMigrationsDir(),
      );
  sqlCache.set(key, created);
  return created;
}

export function createPrefixedKvNamespace(base: KVNamespace, prefix: string): KVNamespace {
  const prefixValue = `${prefix}:`;
  const withPrefix = (key: string) => `${prefixValue}${key}`;
  const stripPrefix = (key: string) => key.startsWith(prefixValue) ? key.slice(prefixValue.length) : key;

  const namespace = {
    async get(key: string, type?: 'text' | 'json' | 'arrayBuffer' | 'stream') {
      return (base.get as unknown as (key: string, type?: string) => Promise<string | ArrayBuffer | ReadableStream | null>)(
        withPrefix(key),
        type,
      );
    },
    async getWithMetadata(key: string, type?: 'text' | 'json' | 'arrayBuffer' | 'stream') {
      return (base.getWithMetadata as unknown as (
        key: string,
        type?: string,
      ) => Promise<{ value: string | ArrayBuffer | ReadableStream | null; metadata: unknown }>)(
        withPrefix(key),
        type,
      );
    },
    async put(
      key: string,
      value: string | ArrayBuffer | ReadableStream,
      options?: {
        expirationTtl?: number;
        expiration?: number;
        metadata?: Record<string, string>;
      },
    ) {
      await (base.put as unknown as (
        key: string,
        value: string | ArrayBuffer | ArrayBufferView | ReadableStream,
        options?: {
          expiration?: number;
          expirationTtl?: number;
          metadata?: Record<string, string | null>;
        },
      ) => Promise<void>)(withPrefix(key), value, options);
    },
    async delete(key: string) {
      await base.delete(withPrefix(key));
    },
    async list(options?: { prefix?: string; limit?: number; cursor?: string }) {
      const result = await base.list({
        limit: options?.limit,
        cursor: options?.cursor,
        prefix: withPrefix(options?.prefix ?? ''),
      });
      return {
        ...result,
        keys: (result.keys ?? [])
          .filter((entry) => entry.name.startsWith(prefixValue))
          .map((entry) => ({ ...entry, name: stripPrefix(entry.name) })),
      };
    },
  };

  return namespace as KVNamespace;
}

function resolvePortableObjectStoreCloudAdapter(resource: PortableResourceRef): R2Bucket | null {
  const bucketName = resource.provider_resource_name;
  if (!bucketName) return null;

  switch (resource.provider_name) {
    case 'aws':
    case 'k8s':
      return createS3ObjectStore({
        region: optionalEnv('AWS_REGION') ?? 'us-east-1',
        bucket: bucketName,
        accessKeyId: optionalEnv('AWS_ACCESS_KEY_ID'),
        secretAccessKey: optionalEnv('AWS_SECRET_ACCESS_KEY'),
        endpoint: optionalEnv('AWS_S3_ENDPOINT'),
      });
    case 'gcp':
      return createGcsObjectStore({
        bucket: bucketName,
        projectId: optionalEnv('GCP_PROJECT_ID'),
        keyFilePath: optionalEnv('GOOGLE_APPLICATION_CREDENTIALS'),
      });
    default:
      return null;
  }
}

export function getPortableObjectStore(resource: PortableResourceRef): R2Bucket {
  const key = resourceCacheKey(resource);
  const existing = objectStoreCache.get(key);
  if (existing) return existing;

  const bucket =
    resolvePortableObjectStoreCloudAdapter(resource)
    ?? createPersistentR2Bucket(`${resolveResourceBasePath('object-store', resource)}.json`);
  objectStoreCache.set(key, bucket);
  return bucket;
}

function resolvePortableKvCloudAdapter(resource: PortableResourceRef): KVNamespace | null {
  const namespacePrefix = sanitizeName(resource.provider_resource_name ?? resource.id);

  switch (resource.provider_name) {
    case 'aws': {
      const tableName = optionalEnv('AWS_DYNAMO_KV_TABLE') ?? optionalEnv('AWS_DYNAMO_HOSTNAME_ROUTING_TABLE');
      if (!tableName) return null;
      const base = createDynamoKvStore({
        region: optionalEnv('AWS_REGION') ?? 'us-east-1',
        tableName,
        accessKeyId: optionalEnv('AWS_ACCESS_KEY_ID'),
        secretAccessKey: optionalEnv('AWS_SECRET_ACCESS_KEY'),
      });
      return createPrefixedKvNamespace(base, namespacePrefix);
    }
    case 'gcp': {
      const collectionName = optionalEnv('GCP_FIRESTORE_KV_COLLECTION');
      if (!collectionName) return null;
      const base = createFirestoreKvStore({
        projectId: optionalEnv('GCP_PROJECT_ID'),
        keyFilePath: optionalEnv('GOOGLE_APPLICATION_CREDENTIALS'),
        collectionName,
      });
      return createPrefixedKvNamespace(base, namespacePrefix);
    }
    default:
      return null;
  }
}

export function getPortableKvStore(resource: PortableResourceRef): KVNamespace {
  const key = resourceCacheKey(resource);
  const existing = kvStoreCache.get(key);
  if (existing) return existing;

  const resolution = describePortableResourceResolution(resource.provider_name, 'kv');
  const cloudAdapter = resolvePortableKvCloudAdapter(resource);
  if (resolution?.mode === 'provider-backed' && !cloudAdapter) {
    assertPortableBootstrapRequirements(resource, 'kv');
  }

  const kv =
    cloudAdapter
    ?? createPersistentKVNamespace(`${resolveResourceBasePath('kv', resource)}.json`);
  kvStoreCache.set(key, kv);
  return kv;
}

async function clearPortableObjectStore(resource: PortableResourceRef): Promise<void> {
  const bucket = getPortableObjectStore(resource);
  let cursor: string | undefined;

  do {
    const page = await bucket.list({ cursor });
    const objects = page.objects ?? [];
    if (objects.length === 0) break;
    await Promise.all(objects.map((object) => bucket.delete(object.key)));
    cursor = page.truncated ? page.cursor ?? undefined : undefined;
  } while (cursor);
}

async function clearPortableKvNamespace(resource: PortableResourceRef): Promise<void> {
  const kv = getPortableKvStore(resource);
  let cursor: string | undefined;

  do {
    const page = await kv.list({ cursor, limit: 1000 });
    const keys = page.keys ?? [];
    if (keys.length === 0) break;
    await Promise.all(keys.map((entry) => kv.delete(entry.name)));
    cursor = page.list_complete ? undefined : page.cursor ?? undefined;
  } while (cursor);
}

function resourceCapability(typeOrCapability?: string | null): ResourceCapability | null {
  return toResourceCapability(typeOrCapability);
}

export async function ensurePortableManagedResource(
  resource: PortableResourceRef,
  typeOrCapability?: string | null,
): Promise<void> {
  const capability = resourceCapability(typeOrCapability);
  if (!capability) return;

  switch (capability) {
    case 'sql':
      assertPortableBootstrapRequirements(resource, capability);
      await getPortableSqlDatabase(resource);
      return;
    case 'object_store':
      if (describePortableResourceResolution(resource.provider_name, capability)?.mode === 'provider-backed') {
        getPortableObjectStore(resource);
      } else if (!resolvePortableObjectStoreCloudAdapter(resource)) {
        await ensureJsonStateFile(`${resolveResourceBasePath('object-store', resource)}.json`, {
          objects: {},
          uploads: {},
        });
      }
      return;
    case 'kv':
      assertPortableBootstrapRequirements(resource, capability);
      if (describePortableResourceResolution(resource.provider_name, capability)?.mode === 'provider-backed') {
        getPortableKvStore(resource);
      } else if (!resolvePortableKvCloudAdapter(resource)) {
        await ensureJsonStateFile(`${resolveResourceBasePath('kv', resource)}.json`, {});
      }
      return;
    case 'queue':
      assertPortableBootstrapRequirements(resource, capability);
      switch (normalizePortableProvider(resource.provider_name)) {
        case 'aws':
          await ensurePortableAwsQueue(resource);
          return;
        case 'gcp':
          await ensurePortableGcpQueue(resource);
          return;
        case 'k8s':
          createRedisQueue(resolveRedisUrl()!, resolvePortableQueueName(resource));
          return;
        default:
          await ensureJsonStateFile(`${resolveResourceBasePath('queue', resource)}.json`, { messages: [] });
          return;
      }
    case 'vector_index':
      await ensurePortableVectorStore(resource);
      return;
    case 'analytics_store':
    case 'workflow_runtime':
    case 'durable_namespace':
      return;
    case 'secret':
      assertPortableBootstrapRequirements(resource, capability);
      if (describePortableResourceResolution(resource.provider_name, capability)?.mode === 'provider-backed') {
        await ensurePortableProviderSecret(resource);
      } else {
        await getPortableSecretValue(resource);
      }
      return;
  }
}

export async function deletePortableManagedResource(
  resource: PortableResourceRef,
  typeOrCapability?: string | null,
): Promise<void> {
  const capability = resourceCapability(typeOrCapability);
  if (!capability) return;

  const key = resourceCacheKey(resource);

  switch (capability) {
    case 'sql': {
      const cached = sqlCache.get(key);
      if (cached) {
        const db = await cached;
        (db as D1Database & { close?: () => void }).close?.();
      }
      sqlCache.delete(key);
      if (usesPortablePostgres(resource)) {
        await dropPortableSqlSchema(resolvePortableSqlSchemaName(resource));
      } else {
        await removePath(`${resolveResourceBasePath('sql', resource)}.sqlite`);
      }
      return;
    }
    case 'object_store':
      objectStoreCache.delete(key);
      if (resolvePortableObjectStoreCloudAdapter(resource)) {
        await clearPortableObjectStore(resource);
      } else {
        await removePath(`${resolveResourceBasePath('object-store', resource)}.json`);
      }
      return;
    case 'kv':
      kvStoreCache.delete(key);
      if (resolvePortableKvCloudAdapter(resource)) {
        await clearPortableKvNamespace(resource);
      } else {
        await removePath(`${resolveResourceBasePath('kv', resource)}.json`);
      }
      return;
    case 'queue':
      switch (normalizePortableProvider(resource.provider_name)) {
        case 'aws':
          await deletePortableAwsQueue(resource);
          return;
        case 'gcp':
          await deletePortableGcpQueue(resource);
          return;
        case 'k8s':
          await clearPortableRedisQueue(resource);
          return;
        default:
          await removePath(`${resolveResourceBasePath('queue', resource)}.json`);
          return;
      }
    case 'vector_index':
      await dropPortableVectorStore(resource);
      await removePath(markerFilePath(markerKindForCapability(capability), resource));
      return;
    case 'analytics_store':
    case 'workflow_runtime':
    case 'durable_namespace':
      await removePath(markerFilePath(markerKindForCapability(capability), resource));
      return;
    case 'secret':
      switch (normalizePortableProvider(resource.provider_name)) {
        case 'aws': {
          const store = createAwsSecretsStore({
            region: resolveAwsRegion(),
            accessKeyId: optionalEnv('AWS_ACCESS_KEY_ID'),
            secretAccessKey: optionalEnv('AWS_SECRET_ACCESS_KEY'),
          });
          await store.deleteSecret(sanitizeName(resource.provider_resource_name ?? resource.id));
          return;
        }
        case 'gcp': {
          const store = createGcpSecretStore({
            projectId: optionalEnv('GCP_PROJECT_ID'),
            keyFilePath: optionalEnv('GOOGLE_APPLICATION_CREDENTIALS'),
          });
          await store.deleteSecret(sanitizeName(resource.provider_resource_name ?? resource.id));
          return;
        }
        case 'k8s': {
          const store = createK8sSecretStore({
            apiServer: optionalEnv('K8S_API_SERVER'),
            namespace: optionalEnv('K8S_NAMESPACE'),
            bearerToken: optionalEnv('K8S_BEARER_TOKEN'),
            caFilePath: optionalEnv('K8S_CA_CERT_FILE'),
          });
          await store.deleteSecret(sanitizeName(resource.provider_resource_name ?? resource.id));
          return;
        }
        default:
          await removePath(markerFilePath(markerKindForCapability(capability), resource));
          return;
      }
      return;
  }
}

export function resetPortableResourceRuntimeCachesForTests(): void {
  sqlCache.clear();
  objectStoreCache.clear();
  kvStoreCache.clear();
}
