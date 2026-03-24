import type { Env } from '../../shared/types/index.ts';
import type { DispatchEnv } from '../../dispatch.ts';
import { createPostgresD1Database } from '../../local-platform/persistent-bindings.ts';
import { createRedisRoutingStore, createRedisQueue } from '../../local-platform/redis-bindings.ts';
import { createRedisDurableObjectNamespace } from '../../shared-cloud-bindings/redis-durable-object.ts';
import { createGcsObjectStore } from '../bindings/gcs-object-store.ts';
import { createPubSubQueue } from '../bindings/pubsub-queue.ts';
import { createInMemoryKVNamespace } from '../../local-platform/in-memory-bindings.ts';

// ---------------------------------------------------------------------------
// Env helpers
// ---------------------------------------------------------------------------

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function optionalEnv(name: string): string | undefined {
  return process.env[name]?.trim() || undefined;
}

// ---------------------------------------------------------------------------
// Queue factory — Pub/Sub when a topic is configured, Redis fallback otherwise
// ---------------------------------------------------------------------------

function createQueue<T = unknown>(
  projectId: string | undefined,
  redisUrl: string,
  pubsubTopicEnvKey: string,
  redisQueueName: string,
) {
  const topicName = optionalEnv(pubsubTopicEnvKey);
  if (topicName) {
    return createPubSubQueue<T>({
      projectId,
      topicName,
      keyFilePath: optionalEnv('GOOGLE_APPLICATION_CREDENTIALS'),
    });
  }
  return createRedisQueue<T>(redisUrl, redisQueueName);
}

// ---------------------------------------------------------------------------
// GCS bucket factory
// ---------------------------------------------------------------------------

function createBucket(projectId: string | undefined, bucketEnvKey: string) {
  const bucket = requireEnv(bucketEnvKey);
  return createGcsObjectStore({
    bucket,
    projectId,
    keyFilePath: optionalEnv('GOOGLE_APPLICATION_CREDENTIALS'),
  });
}

// ---------------------------------------------------------------------------
// Web Env
// ---------------------------------------------------------------------------

export async function createTakosGcpWebEnv(): Promise<Env> {
  const projectId = optionalEnv('GCP_PROJECT_ID');
  const postgresUrl = requireEnv('DATABASE_URL');
  const redisUrl = requireEnv('REDIS_URL');

  const db = await createPostgresD1Database(postgresUrl);

  // Queues: Pub/Sub if topic names provided, otherwise fall back to Redis
  const runQueue = createQueue(projectId, redisUrl, 'GCP_PUBSUB_RUN_TOPIC', 'takos-runs');
  const indexQueue = createQueue(projectId, redisUrl, 'GCP_PUBSUB_INDEX_TOPIC', 'takos-index');
  const workflowQueue = createQueue(projectId, redisUrl, 'GCP_PUBSUB_WORKFLOW_TOPIC', 'takos-workflow');
  const deployQueue = createQueue(projectId, redisUrl, 'GCP_PUBSUB_DEPLOY_TOPIC', 'takos-deploy');

  // Object storage: GCS buckets
  const gitObjects = createBucket(projectId, 'GCP_GCS_GIT_OBJECTS_BUCKET');
  const offload = createBucket(projectId, 'GCP_GCS_OFFLOAD_BUCKET');
  const tenantSource = createBucket(projectId, 'GCP_GCS_TENANT_SOURCE_BUCKET');
  const workerBundles = createBucket(projectId, 'GCP_GCS_WORKER_BUNDLES_BUCKET');
  const tenantBuilds = createBucket(projectId, 'GCP_GCS_TENANT_BUILDS_BUCKET');
  const uiBundles = createBucket(projectId, 'GCP_GCS_UI_BUNDLES_BUCKET');

  // KV: In-memory for hostname routing (cache layer, routing truth is in ROUTING_STORE)
  const hostnameRouting = createInMemoryKVNamespace();

  // Routing store: Redis (Memorystore)
  const routingStore = createRedisRoutingStore(redisUrl);

  // Durable Objects: Redis-backed emulation (Memorystore)
  const sessionDo = createRedisDurableObjectNamespace(redisUrl, 'session');
  const runNotifier = createRedisDurableObjectNamespace(redisUrl, 'run-notifier');
  const notificationNotifier = createRedisDurableObjectNamespace(redisUrl, 'notification-notifier');
  const gitPushLock = createRedisDurableObjectNamespace(redisUrl, 'git-push-lock');
  const routingDo = createRedisDurableObjectNamespace(redisUrl, 'routing');
  const rateLimiterDo = createRedisDurableObjectNamespace(redisUrl, 'rate-limiter');

  return {
    // Database (Cloud SQL PostgreSQL)
    DB: db,

    // Hostname routing (in-memory KV cache)
    HOSTNAME_ROUTING: hostnameRouting,

    // Routing
    ROUTING_DO: routingDo,
    ROUTING_DO_PHASE: optionalEnv('ROUTING_DO_PHASE') ?? '1',
    ROUTING_STORE: routingStore,

    // Durable Object namespaces (Redis/Memorystore-backed)
    SESSION_DO: sessionDo,
    RUN_NOTIFIER: runNotifier,
    NOTIFICATION_NOTIFIER: notificationNotifier,
    GIT_PUSH_LOCK: gitPushLock,
    RATE_LIMITER_DO: rateLimiterDo,

    // Queues (Pub/Sub or Redis fallback)
    RUN_QUEUE: runQueue,
    INDEX_QUEUE: indexQueue,
    WORKFLOW_QUEUE: workflowQueue,
    DEPLOY_QUEUE: deployQueue,

    // Object storage (GCS-backed)
    GIT_OBJECTS: gitObjects,
    TAKOS_OFFLOAD: offload,
    TENANT_SOURCE: tenantSource,
    WORKER_BUNDLES: workerBundles,
    TENANT_BUILDS: tenantBuilds,
    UI_BUNDLES: uiBundles,

    // Platform config
    GOOGLE_CLIENT_ID: optionalEnv('GOOGLE_CLIENT_ID') ?? '',
    GOOGLE_CLIENT_SECRET: optionalEnv('GOOGLE_CLIENT_SECRET') ?? '',
    ADMIN_DOMAIN: optionalEnv('ADMIN_DOMAIN') ?? '',
    TENANT_BASE_DOMAIN: optionalEnv('TENANT_BASE_DOMAIN') ?? '',
    PLATFORM_PRIVATE_KEY: optionalEnv('PLATFORM_PRIVATE_KEY') ?? '',
    PLATFORM_PUBLIC_KEY: optionalEnv('PLATFORM_PUBLIC_KEY') ?? '',
    ENCRYPTION_KEY: optionalEnv('ENCRYPTION_KEY'),
    SERVICE_INTERNAL_JWT_ISSUER: optionalEnv('SERVICE_INTERNAL_JWT_ISSUER') ?? 'takos-gcp',
    ENVIRONMENT: optionalEnv('ENVIRONMENT') ?? 'production',

    // AI keys
    OPENAI_API_KEY: optionalEnv('OPENAI_API_KEY'),
    ANTHROPIC_API_KEY: optionalEnv('ANTHROPIC_API_KEY'),
    GOOGLE_API_KEY: optionalEnv('GOOGLE_API_KEY'),
    SERPER_API_KEY: optionalEnv('SERPER_API_KEY'),

    // Cloud Run deployment provider env (read by platform adapter)
    OCI_ORCHESTRATOR_URL: optionalEnv('OCI_ORCHESTRATOR_URL'),
    OCI_ORCHESTRATOR_TOKEN: optionalEnv('OCI_ORCHESTRATOR_TOKEN'),

    // Billing
    STRIPE_SECRET_KEY: optionalEnv('STRIPE_SECRET_KEY'),
    STRIPE_WEBHOOK_SECRET: optionalEnv('STRIPE_WEBHOOK_SECRET'),
    STRIPE_PLUS_PRICE_ID: optionalEnv('STRIPE_PLUS_PRICE_ID'),
    STRIPE_PRO_TOPUP_PACKS_JSON: optionalEnv('STRIPE_PRO_TOPUP_PACKS_JSON'),

    // Bot protection
    TURNSTILE_SECRET_KEY: optionalEnv('TURNSTILE_SECRET_KEY'),

    // Security
    AUDIT_IP_HASH_KEY: optionalEnv('AUDIT_IP_HASH_KEY'),
  };
}

// ---------------------------------------------------------------------------
// Dispatch Env
// ---------------------------------------------------------------------------

export async function createTakosGcpDispatchEnv(): Promise<DispatchEnv> {
  const redisUrl = requireEnv('REDIS_URL');

  // Hostname routing: in-memory KV (cache layer)
  const hostnameRouting = createInMemoryKVNamespace();

  // Routing
  const routingStore = createRedisRoutingStore(redisUrl);
  const routingDo = createRedisDurableObjectNamespace(redisUrl, 'routing');

  return {
    HOSTNAME_ROUTING: hostnameRouting,
    ROUTING_DO: routingDo,
    ROUTING_DO_PHASE: optionalEnv('ROUTING_DO_PHASE') ?? '1',
    ROUTING_STORE: routingStore,
    ADMIN_DOMAIN: optionalEnv('ADMIN_DOMAIN') ?? '',
    // DISPATCHER must be provided externally (e.g. via Cloud Run service mesh or
    // an HTTP-based service registry). The caller is responsible for wiring
    // this before passing the env to createDispatchWorker().
  } as DispatchEnv;
}
