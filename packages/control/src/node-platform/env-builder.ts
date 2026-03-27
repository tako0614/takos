/**
 * Composable Env builder for Node.js platforms.
 *
 * Instead of monolithic per-cloud env creators, this module auto-detects
 * which binding implementation to use for each service category based on
 * the environment variables that are set.  This enables blending providers:
 * e.g. S3 for object storage + Pub/Sub for queues + PostgreSQL for DB.
 *
 * Detection priority per category (first match wins):
 *
 *   Database:       DATABASE_URL / POSTGRES_URL → Postgres
 *                   TAKOS_LOCAL_DATA_DIR         → SQLite
 *                   else                         → in-memory D1
 *
 *   Object Storage: AWS_S3_{NAME}_BUCKET         → S3 (+ AWS_S3_ENDPOINT for MinIO)
 *     (per-bucket)  GCP_GCS_{NAME}_BUCKET        → GCS
 *                   TAKOS_LOCAL_DATA_DIR          → persistent R2
 *                   else                          → in-memory R2
 *
 *   Queues:         AWS_SQS_{NAME}_QUEUE_URL     → SQS
 *     (per-queue)   GCP_PUBSUB_{NAME}_TOPIC      → Pub/Sub
 *                   REDIS_URL                     → Redis queue
 *                   TAKOS_LOCAL_DATA_DIR          → persistent queue
 *                   else                          → in-memory queue
 *
 *   KV:             AWS_DYNAMO_KV_TABLE           → DynamoDB
 *                   TAKOS_LOCAL_DATA_DIR          → persistent KV
 *                   else                          → in-memory KV
 *
 *   Durable Objs:   REDIS_URL                    → Redis-backed
 *                   TAKOS_LOCAL_DATA_DIR          → persistent
 *                   else                          → in-memory
 *
 *   Routing Store:  REDIS_URL                    → Redis
 *                   TAKOS_LOCAL_DATA_DIR          → persistent
 *                   else                          → in-memory
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Env } from '../shared/types/index.ts';
import type { DispatchEnv } from '../dispatch.ts';
import type { ServiceBindingFetcher } from '../shared/types/bindings.ts';

// -- Binding factories (lazy-imported to avoid pulling heavy SDKs when unused)
import {
  createInMemoryD1Database,
  createInMemoryDurableObjectNamespace,
  createInMemoryKVNamespace,
  createInMemoryQueue,
  createInMemoryR2Bucket,
} from '../local-platform/in-memory-bindings.ts';
import {
  createPersistentDurableObjectNamespace,
  createPersistentKVNamespace,
  createPersistentQueue,
  createPersistentR2Bucket,
  createPostgresD1Database,
  createSqliteD1Database,
  removeLocalDataDir,
} from '../local-platform/persistent-bindings.ts';
import { createInMemoryRoutingStore, createPersistentRoutingStore } from '../local-platform/routing-store.ts';
import { createRedisQueue, createRedisRoutingStore, disposeRedisClient } from '../local-platform/redis-bindings.ts';
import { createRedisDurableObjectNamespace } from '../shared-cloud-bindings/redis-durable-object.ts';
import { LOCAL_QUEUE_NAMES } from '../local-platform/queue-runtime.ts';
import {
  createForwardingFetcher,
  createFetcherRegistry,
  parseServiceTargetMap,
  type ServiceTargetMap,
} from '../local-platform/url-registry.ts';
import {
  createLocalTenantWorkerRuntimeRegistry,
  type TenantWorkerRuntimeRegistry,
} from '../local-platform/tenant-worker-runtime.ts';

// ---------------------------------------------------------------------------
// Env helpers
// ---------------------------------------------------------------------------

function optionalEnv(name: string): string | undefined {
  return process.env[name]?.trim() || undefined;
}

// ---------------------------------------------------------------------------
// Resolve paths
// ---------------------------------------------------------------------------

function resolveLocalDataDir(): string | null {
  const explicit = optionalEnv('TAKOS_LOCAL_DATA_DIR');
  if (explicit) return path.resolve(explicit);
  if (process.env.VITEST) return null;
  // Only use the default directory if no cloud storage env vars are set —
  // this avoids accidentally creating a .takos-local directory when running
  // on a cloud platform.
  if (hasCloudBindings()) return null;
  return path.resolve(process.cwd(), '.takos-local');
}

function resolvePostgresUrl(): string | null {
  const raw = optionalEnv('POSTGRES_URL') ?? optionalEnv('DATABASE_URL') ?? '';
  if (!raw) return null;
  if (!/^postgres(ql)?:\/\//i.test(raw)) return null;
  return raw;
}

function resolveRedisUrl(): string | null {
  return optionalEnv('REDIS_URL') ?? null;
}

function hasCloudBindings(): boolean {
  return !!(
    optionalEnv('AWS_S3_GIT_OBJECTS_BUCKET') ||
    optionalEnv('GCP_GCS_GIT_OBJECTS_BUCKET') ||
    optionalEnv('AWS_ECS_CLUSTER_ARN') ||
    optionalEnv('GCP_PROJECT_ID')
  );
}

// ---------------------------------------------------------------------------
// Database resolver
// ---------------------------------------------------------------------------

async function resolveDatabase(dataDir: string | null, migrationsDir: string) {
  const postgresUrl = resolvePostgresUrl();
  if (postgresUrl) return createPostgresD1Database(postgresUrl);
  if (dataDir) return createSqliteD1Database(path.join(dataDir, 'db', 'control.sqlite'), migrationsDir);
  return createInMemoryD1Database();
}

// ---------------------------------------------------------------------------
// Object storage resolver (per-bucket)
// ---------------------------------------------------------------------------

const BUCKET_NAMES = [
  'GIT_OBJECTS',
  'TAKOS_OFFLOAD',
  'TENANT_SOURCE',
  'WORKER_BUNDLES',
  'TENANT_BUILDS',
  'UI_BUNDLES',
] as const;

type BucketName = (typeof BUCKET_NAMES)[number];

const S3_ENV_MAP: Record<BucketName, string> = {
  GIT_OBJECTS: 'AWS_S3_GIT_OBJECTS_BUCKET',
  TAKOS_OFFLOAD: 'AWS_S3_OFFLOAD_BUCKET',
  TENANT_SOURCE: 'AWS_S3_TENANT_SOURCE_BUCKET',
  WORKER_BUNDLES: 'AWS_S3_WORKER_BUNDLES_BUCKET',
  TENANT_BUILDS: 'AWS_S3_TENANT_BUILDS_BUCKET',
  UI_BUNDLES: 'AWS_S3_UI_BUNDLES_BUCKET',
};

const GCS_ENV_MAP: Record<BucketName, string> = {
  GIT_OBJECTS: 'GCP_GCS_GIT_OBJECTS_BUCKET',
  TAKOS_OFFLOAD: 'GCP_GCS_OFFLOAD_BUCKET',
  TENANT_SOURCE: 'GCP_GCS_TENANT_SOURCE_BUCKET',
  WORKER_BUNDLES: 'GCP_GCS_WORKER_BUNDLES_BUCKET',
  TENANT_BUILDS: 'GCP_GCS_TENANT_BUILDS_BUCKET',
  UI_BUNDLES: 'GCP_GCS_UI_BUNDLES_BUCKET',
};

const PERSISTENT_BUCKET_MAP: Record<BucketName, string> = {
  GIT_OBJECTS: 'git-objects.json',
  TAKOS_OFFLOAD: 'takos-offload.json',
  TENANT_SOURCE: 'tenant-source.json',
  WORKER_BUNDLES: 'worker-bundles.json',
  TENANT_BUILDS: 'tenant-builds.json',
  UI_BUNDLES: 'ui-bundles.json',
};

async function resolveBucket(name: BucketName, dataDir: string | null) {
  // S3 (including MinIO / S3-compatible)
  const s3Bucket = optionalEnv(S3_ENV_MAP[name]);
  if (s3Bucket) {
    const { createS3ObjectStore } = await import('../bindings/s3-object-store.ts');
    return createS3ObjectStore({
      region: optionalEnv('AWS_REGION') ?? 'us-east-1',
      bucket: s3Bucket,
      accessKeyId: optionalEnv('AWS_ACCESS_KEY_ID'),
      secretAccessKey: optionalEnv('AWS_SECRET_ACCESS_KEY'),
      endpoint: optionalEnv('AWS_S3_ENDPOINT'),
    });
  }

  // GCS
  const gcsBucket = optionalEnv(GCS_ENV_MAP[name]);
  if (gcsBucket) {
    const { createGcsObjectStore } = await import('../bindings/gcs-object-store.ts');
    return createGcsObjectStore({
      bucket: gcsBucket,
      projectId: optionalEnv('GCP_PROJECT_ID'),
      keyFilePath: optionalEnv('GOOGLE_APPLICATION_CREDENTIALS'),
    });
  }

  // Persistent local
  if (dataDir) return createPersistentR2Bucket(path.join(dataDir, 'buckets', PERSISTENT_BUCKET_MAP[name]));

  // In-memory
  return createInMemoryR2Bucket();
}

// ---------------------------------------------------------------------------
// Queue resolver (per-queue)
// ---------------------------------------------------------------------------

type QueueName = 'RUN' | 'INDEX' | 'WORKFLOW' | 'DEPLOY';

const SQS_ENV_MAP: Record<QueueName, string> = {
  RUN: 'AWS_SQS_RUN_QUEUE_URL',
  INDEX: 'AWS_SQS_INDEX_QUEUE_URL',
  WORKFLOW: 'AWS_SQS_WORKFLOW_QUEUE_URL',
  DEPLOY: 'AWS_SQS_DEPLOY_QUEUE_URL',
};

const PUBSUB_ENV_MAP: Record<QueueName, string> = {
  RUN: 'GCP_PUBSUB_RUN_TOPIC',
  INDEX: 'GCP_PUBSUB_INDEX_TOPIC',
  WORKFLOW: 'GCP_PUBSUB_WORKFLOW_TOPIC',
  DEPLOY: 'GCP_PUBSUB_DEPLOY_TOPIC',
};

const REDIS_QUEUE_MAP: Record<QueueName, string> = {
  RUN: LOCAL_QUEUE_NAMES.run,
  INDEX: LOCAL_QUEUE_NAMES.index,
  WORKFLOW: LOCAL_QUEUE_NAMES.workflow,
  DEPLOY: LOCAL_QUEUE_NAMES.deployment,
};

const PERSISTENT_QUEUE_MAP: Record<QueueName, string> = {
  RUN: 'run-queue.json',
  INDEX: 'index-queue.json',
  WORKFLOW: 'workflow-queue.json',
  DEPLOY: 'deploy-queue.json',
};

async function resolveQueue<T = unknown>(
  name: QueueName,
  redisUrl: string | null,
  dataDir: string | null,
) {
  // SQS
  const sqsUrl = optionalEnv(SQS_ENV_MAP[name]);
  if (sqsUrl) {
    const { createSqsQueue } = await import('../bindings/sqs-queue.ts');
    return createSqsQueue<T>({
      region: optionalEnv('AWS_REGION') ?? 'us-east-1',
      queueUrl: sqsUrl,
      accessKeyId: optionalEnv('AWS_ACCESS_KEY_ID'),
      secretAccessKey: optionalEnv('AWS_SECRET_ACCESS_KEY'),
    });
  }

  // Pub/Sub
  const pubsubTopic = optionalEnv(PUBSUB_ENV_MAP[name]);
  if (pubsubTopic) {
    const { createPubSubQueue } = await import('../bindings/pubsub-queue.ts');
    return createPubSubQueue<T>({
      projectId: optionalEnv('GCP_PROJECT_ID'),
      topicName: pubsubTopic,
      keyFilePath: optionalEnv('GOOGLE_APPLICATION_CREDENTIALS'),
    });
  }

  // Redis
  if (redisUrl) return createRedisQueue<T>(redisUrl, REDIS_QUEUE_MAP[name]);

  // Persistent local
  if (dataDir) return createPersistentQueue<T>(path.join(dataDir, 'queues', PERSISTENT_QUEUE_MAP[name]), REDIS_QUEUE_MAP[name]);

  // In-memory
  return createInMemoryQueue<T>(REDIS_QUEUE_MAP[name]);
}

// ---------------------------------------------------------------------------
// KV resolver
// ---------------------------------------------------------------------------

async function resolveKvStore(dataDir: string | null) {
  const dynamoTable = optionalEnv('AWS_DYNAMO_KV_TABLE') ?? optionalEnv('AWS_DYNAMO_HOSTNAME_ROUTING_TABLE');
  if (dynamoTable) {
    const { createDynamoKvStore } = await import('../bindings/dynamo-kv-store.ts');
    return createDynamoKvStore({
      region: optionalEnv('AWS_REGION') ?? 'us-east-1',
      tableName: dynamoTable,
      accessKeyId: optionalEnv('AWS_ACCESS_KEY_ID'),
      secretAccessKey: optionalEnv('AWS_SECRET_ACCESS_KEY'),
    });
  }
  if (dataDir) return createPersistentKVNamespace(path.join(dataDir, 'kv', 'hostname-routing.json'));
  return createInMemoryKVNamespace();
}

// ---------------------------------------------------------------------------
// Durable Objects resolver
// ---------------------------------------------------------------------------

function resolveDurableObject(name: string, redisUrl: string | null, dataDir: string | null) {
  if (redisUrl) return createRedisDurableObjectNamespace(redisUrl, name);
  if (dataDir) return createPersistentDurableObjectNamespace(path.join(dataDir, 'durable-objects', `${name}.json`));
  return createInMemoryDurableObjectNamespace();
}

// ---------------------------------------------------------------------------
// Routing store resolver
// ---------------------------------------------------------------------------

function resolveRoutingStore(redisUrl: string | null, dataDir: string | null) {
  if (redisUrl) return createRedisRoutingStore(redisUrl);
  if (dataDir) return createPersistentRoutingStore(path.join(dataDir, 'routing', 'routing-store.json'));
  return createInMemoryRoutingStore();
}

// ---------------------------------------------------------------------------
// Shared state (lazy singleton — same pattern as local-platform)
// ---------------------------------------------------------------------------

type SharedState = Awaited<ReturnType<typeof buildSharedState>>;

async function buildSharedState() {
  const dataDir = resolveLocalDataDir();
  const redisUrl = resolveRedisUrl();
  const packageDir = path.dirname(fileURLToPath(import.meta.url));
  const migrationsDir = path.resolve(packageDir, '../../../../packages/control/db/migrations');

  const db = await resolveDatabase(dataDir, migrationsDir);
  const hostnameRouting = await resolveKvStore(dataDir);
  const routingStore = resolveRoutingStore(redisUrl, dataDir);

  const routingDo = resolveDurableObject('routing', redisUrl, dataDir);
  const sessionDo = resolveDurableObject('session', redisUrl, dataDir);
  const runNotifier = resolveDurableObject('run-notifier', redisUrl, dataDir);
  const notificationNotifier = resolveDurableObject('notification-notifier', redisUrl, dataDir);
  const gitPushLock = resolveDurableObject('git-push-lock', redisUrl, dataDir);
  const rateLimiterDo = resolveDurableObject('rate-limiter', redisUrl, dataDir);

  const runQueue = await resolveQueue('RUN', redisUrl, dataDir);
  const indexQueue = await resolveQueue('INDEX', redisUrl, dataDir);
  const workflowQueue = await resolveQueue('WORKFLOW', redisUrl, dataDir);
  const deployQueue = await resolveQueue('DEPLOY', redisUrl, dataDir);

  const [gitObjects, offload, tenantSource, workerBundles, tenantBuilds, uiBundles] = await Promise.all([
    resolveBucket('GIT_OBJECTS', dataDir),
    resolveBucket('TAKOS_OFFLOAD', dataDir),
    resolveBucket('TENANT_SOURCE', dataDir),
    resolveBucket('WORKER_BUNDLES', dataDir),
    resolveBucket('TENANT_BUILDS', dataDir),
    resolveBucket('UI_BUNDLES', dataDir),
  ]);

  return {
    dataDir,
    db,
    hostnameRouting,
    routingStore,
    routingDo,
    sessionDo,
    runNotifier,
    notificationNotifier,
    gitPushLock,
    rateLimiterDo,
    runQueue,
    indexQueue,
    workflowQueue,
    deployQueue,
    gitObjects,
    offload,
    tenantSource,
    workerBundles,
    tenantBuilds,
    uiBundles,
  };
}

let sharedPromise: Promise<SharedState> | null = null;
const dispatchRegistries = new Set<TenantWorkerRuntimeRegistry>();

async function getSharedState(): Promise<SharedState> {
  if (!sharedPromise) {
    sharedPromise = buildSharedState().catch((error) => {
      sharedPromise = null;
      throw error;
    });
  }
  return sharedPromise;
}

// ---------------------------------------------------------------------------
// Routing seed (for local / dev setups)
// ---------------------------------------------------------------------------

type RoutingRecordInput = {
  type?: 'deployments' | 'http-endpoint-set';
  deployments?: Array<{
    routeRef: string;
    weight?: number;
    deploymentId?: string;
    status?: 'active' | 'canary' | 'rollback';
  }>;
  endpoints?: Array<{
    name: string;
    routes: Array<{ pathPrefix?: string; methods?: string[] }>;
    target: { kind: 'service-ref'; ref: string } | { kind: 'http-url'; baseUrl: string };
    timeoutMs?: number;
  }>;
};

function parseRoutingSeed(raw: string | undefined): Record<string, RoutingRecordInput> {
  if (!raw) return {};
  const parsed = JSON.parse(raw) as unknown;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('TAKOS_LOCAL_ROUTING_JSON must be a JSON object');
  }
  return parsed as Record<string, RoutingRecordInput>;
}

function serializeRoutingValue(value: RoutingRecordInput): string {
  return JSON.stringify(value);
}

let seeded = false;

async function ensureRoutingSeeded(): Promise<void> {
  if (seeded) return;
  seeded = true;

  const shared = await getSharedState();
  const routingSeed = parseRoutingSeed(optionalEnv('TAKOS_LOCAL_ROUTING_JSON'));
  for (const [hostname, value] of Object.entries(routingSeed)) {
    await shared.hostnameRouting.put(hostname.toLowerCase(), serializeRoutingValue(value));
    const target = value.type === 'http-endpoint-set'
      ? { type: 'http-endpoint-set' as const, endpoints: value.endpoints ?? [] }
      : { type: 'deployments' as const, deployments: (value.deployments ?? []).map((deployment) => ({
          routeRef: deployment.routeRef,
          weight: deployment.weight ?? 100,
          ...(deployment.deploymentId ? { deploymentId: deployment.deploymentId } : {}),
          status: deployment.status ?? 'active',
        })) };
    await shared.routingStore.putRecord(hostname, target, Date.now());
  }
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

export async function disposeNodePlatformState(): Promise<void> {
  const pendingState = sharedPromise;
  sharedPromise = null;
  seeded = false;
  const state = pendingState ? await pendingState.catch(() => null) : null;
  if (state) {
    await Promise.resolve((state.db as typeof state.db & { close?: () => Promise<void> | void }).close?.())
      .catch(() => undefined);
  }
  await Promise.all(Array.from(dispatchRegistries, (registry) => registry.dispose().catch(() => undefined)));
  dispatchRegistries.clear();
  await disposeRedisClient();
}

export async function resetNodePlatformStateForTests(): Promise<void> {
  await disposeNodePlatformState();
}

export async function clearNodePlatformDataForTests(): Promise<void> {
  const dataDir = resolveLocalDataDir();
  if (!dataDir) return;
  await removeLocalDataDir(dataDir);
}

// ---------------------------------------------------------------------------
// Build config
// ---------------------------------------------------------------------------

function buildBaseConfig(isLocal: boolean) {
  return {
    ADMIN_DOMAIN: optionalEnv('ADMIN_DOMAIN') ?? (isLocal ? 'takos.localhost' : ''),
    TENANT_BASE_DOMAIN: optionalEnv('TENANT_BASE_DOMAIN') ?? (isLocal ? 'tenant.localhost' : ''),
    GOOGLE_CLIENT_ID: optionalEnv('GOOGLE_CLIENT_ID') ?? (isLocal ? 'local-google-client' : ''),
    GOOGLE_CLIENT_SECRET: optionalEnv('GOOGLE_CLIENT_SECRET') ?? (isLocal ? 'local-google-secret' : ''),
    PLATFORM_PRIVATE_KEY: optionalEnv('PLATFORM_PRIVATE_KEY') ?? (isLocal ? 'local-platform-private-key' : ''),
    PLATFORM_PUBLIC_KEY: optionalEnv('PLATFORM_PUBLIC_KEY') ?? (isLocal ? 'local-platform-public-key' : ''),
    CF_ACCOUNT_ID: optionalEnv('CF_ACCOUNT_ID'),
    CF_API_TOKEN: optionalEnv('CF_API_TOKEN'),
    CF_ZONE_ID: optionalEnv('CF_ZONE_ID'),
    WFP_DISPATCH_NAMESPACE: optionalEnv('WFP_DISPATCH_NAMESPACE'),
    ENCRYPTION_KEY: optionalEnv('ENCRYPTION_KEY') ?? (isLocal ? 'local-encryption-key' : ''),
    SERVICE_INTERNAL_JWT_ISSUER: optionalEnv('SERVICE_INTERNAL_JWT_ISSUER') ?? 'takos-node',
    ENVIRONMENT: optionalEnv('ENVIRONMENT') ?? (isLocal ? 'development' : 'production'),
    ROUTING_DO_PHASE: optionalEnv('ROUTING_DO_PHASE') ?? '1',
  } as const;
}

// ---------------------------------------------------------------------------
// Public: createNodeWebEnv
// ---------------------------------------------------------------------------

export async function createNodeWebEnv(): Promise<Env> {
  await ensureRoutingSeeded();
  const shared = await getSharedState();
  const config = buildBaseConfig(shared.dataDir !== null);

  return {
    DB: shared.db,
    HOSTNAME_ROUTING: shared.hostnameRouting,
    ROUTING_DO: shared.routingDo,
    ROUTING_DO_PHASE: config.ROUTING_DO_PHASE,
    ROUTING_STORE: shared.routingStore,
    SESSION_DO: shared.sessionDo,
    RUN_NOTIFIER: shared.runNotifier,
    NOTIFICATION_NOTIFIER: shared.notificationNotifier,
    GIT_PUSH_LOCK: shared.gitPushLock,
    RATE_LIMITER_DO: shared.rateLimiterDo,
    RUN_QUEUE: shared.runQueue,
    INDEX_QUEUE: shared.indexQueue,
    WORKFLOW_QUEUE: shared.workflowQueue,
    DEPLOY_QUEUE: shared.deployQueue,
    GIT_OBJECTS: shared.gitObjects,
    TAKOS_OFFLOAD: shared.offload,
    TENANT_SOURCE: shared.tenantSource,
    WORKER_BUNDLES: shared.workerBundles,
    TENANT_BUILDS: shared.tenantBuilds,
    UI_BUNDLES: shared.uiBundles,
    GOOGLE_CLIENT_ID: config.GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET: config.GOOGLE_CLIENT_SECRET,
    ADMIN_DOMAIN: config.ADMIN_DOMAIN,
    TENANT_BASE_DOMAIN: config.TENANT_BASE_DOMAIN,
    PLATFORM_PRIVATE_KEY: config.PLATFORM_PRIVATE_KEY,
    PLATFORM_PUBLIC_KEY: config.PLATFORM_PUBLIC_KEY,
    CF_ACCOUNT_ID: config.CF_ACCOUNT_ID,
    CF_API_TOKEN: config.CF_API_TOKEN,
    CF_ZONE_ID: config.CF_ZONE_ID,
    WFP_DISPATCH_NAMESPACE: config.WFP_DISPATCH_NAMESPACE,
    OCI_ORCHESTRATOR_URL: optionalEnv('OCI_ORCHESTRATOR_URL'),
    OCI_ORCHESTRATOR_TOKEN: optionalEnv('OCI_ORCHESTRATOR_TOKEN'),
    ENCRYPTION_KEY: config.ENCRYPTION_KEY,
    SERVICE_INTERNAL_JWT_ISSUER: config.SERVICE_INTERNAL_JWT_ISSUER,
    ENVIRONMENT: config.ENVIRONMENT,
    OPENAI_API_KEY: optionalEnv('OPENAI_API_KEY'),
    ANTHROPIC_API_KEY: optionalEnv('ANTHROPIC_API_KEY'),
    GOOGLE_API_KEY: optionalEnv('GOOGLE_API_KEY'),
    SERPER_API_KEY: optionalEnv('SERPER_API_KEY'),
    STRIPE_SECRET_KEY: optionalEnv('STRIPE_SECRET_KEY'),
    STRIPE_WEBHOOK_SECRET: optionalEnv('STRIPE_WEBHOOK_SECRET'),
    STRIPE_PLUS_PRICE_ID: optionalEnv('STRIPE_PLUS_PRICE_ID'),
    STRIPE_PRO_TOPUP_PACKS_JSON: optionalEnv('STRIPE_PRO_TOPUP_PACKS_JSON'),
    TURNSTILE_SECRET_KEY: optionalEnv('TURNSTILE_SECRET_KEY'),
    AUDIT_IP_HASH_KEY: optionalEnv('AUDIT_IP_HASH_KEY'),
  };
}

// ---------------------------------------------------------------------------
// Public: createNodeDispatchEnv
// ---------------------------------------------------------------------------

const LOCAL_FORWARD_SERVICE_NAMES = new Set([
  'RUNTIME_HOST',
  'runtime-host',
  'EXECUTOR_HOST',
  'executor-host',
  'BROWSER_HOST',
  'browser-host',
  'TAKOS_EGRESS',
  'takos-egress',
]);

function validateLocalForwardTargets(targets: ServiceTargetMap): ServiceTargetMap {
  const invalidTargets = Object.keys(targets).filter((name) => !LOCAL_FORWARD_SERVICE_NAMES.has(name));
  if (invalidTargets.length > 0) {
    throw new Error(
      `TAKOS_LOCAL_DISPATCH_TARGETS_JSON may only override infra service targets: ${invalidTargets.join(', ')}`,
    );
  }
  return targets;
}

function createStrictLocalServiceRegistry(
  forwardTargets: ServiceTargetMap,
  tenantWorkerRuntimeRegistry: TenantWorkerRuntimeRegistry,
): DispatchEnv['DISPATCHER'] {
  return {
    get(name: string, options?: { deploymentId?: string }): ServiceBindingFetcher {
      const target = forwardTargets[name];
      if (target) {
        return createForwardingFetcher(target);
      }
      return tenantWorkerRuntimeRegistry.get(name, options) as unknown as ServiceBindingFetcher;
    },
  } as unknown as DispatchEnv['DISPATCHER'];
}

function collectImplicitForwardTargets(): Record<string, string> {
  const targets: Record<string, string> = {};
  for (const [envKey, serviceName] of [
    ['TAKOS_LOCAL_RUNTIME_URL', 'runtime-host'],
    ['TAKOS_LOCAL_EXECUTOR_URL', 'executor-host'],
    ['TAKOS_LOCAL_BROWSER_URL', 'browser-host'],
    ['TAKOS_LOCAL_EGRESS_URL', 'takos-egress'],
    ['TAKOS_RUNTIME_HOST_URL', 'runtime-host'],
    ['TAKOS_EXECUTOR_HOST_URL', 'executor-host'],
    ['TAKOS_BROWSER_HOST_URL', 'browser-host'],
    ['TAKOS_EGRESS_URL', 'takos-egress'],
  ] as const) {
    const url = optionalEnv(envKey);
    if (url) {
      targets[serviceName] = url;
      targets[serviceName.toUpperCase().replace(/-/g, '_')] = url;
    }
  }
  return targets;
}

export async function createNodeDispatchEnv(): Promise<DispatchEnv> {
  await ensureRoutingSeeded();
  const shared = await getSharedState();
  const config = buildBaseConfig(shared.dataDir !== null);

  const forwardTargets = { ...collectImplicitForwardTargets() };

  let dispatcher: DispatchEnv['DISPATCHER'];

  if (shared.dataDir !== null) {
    // Local mode: forward targets + TenantWorkerRuntimeRegistry (Miniflare)
    const explicitTargets = validateLocalForwardTargets(
      parseServiceTargetMap(optionalEnv('TAKOS_LOCAL_DISPATCH_TARGETS_JSON')),
    );
    Object.assign(forwardTargets, explicitTargets);

    const tenantWorkerRuntimeRegistry = await createLocalTenantWorkerRuntimeRegistry({
      dataDir: shared.dataDir,
      db: shared.db,
      workerBundles: shared.workerBundles,
      encryptionKey: config.ENCRYPTION_KEY,
      serviceTargets: forwardTargets,
    });
    dispatchRegistries.add(tenantWorkerRuntimeRegistry);
    dispatcher = createStrictLocalServiceRegistry(forwardTargets, tenantWorkerRuntimeRegistry);
  } else {
    // Cloud mode: forward targets only (tenant execution delegated to external platform)
    dispatcher = createFetcherRegistry(forwardTargets) as unknown as DispatchEnv['DISPATCHER'];
  }

  return {
    HOSTNAME_ROUTING: shared.hostnameRouting,
    ROUTING_DO: shared.routingDo,
    ROUTING_DO_PHASE: config.ROUTING_DO_PHASE,
    ROUTING_STORE: shared.routingStore,
    ADMIN_DOMAIN: config.ADMIN_DOMAIN,
    DISPATCHER: dispatcher,
  };
}
