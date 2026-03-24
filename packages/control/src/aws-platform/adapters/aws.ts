import type { Env } from '../../shared/types/index.ts';
import type { DispatchEnv } from '../../dispatch.ts';
import { createPostgresD1Database } from '../../local-platform/persistent-bindings.ts';
import { createRedisRoutingStore, createRedisQueue } from '../../local-platform/redis-bindings.ts';
import { createRedisDurableObjectNamespace } from '../../shared-cloud-bindings/redis-durable-object.ts';
import { createS3ObjectStore } from '../bindings/s3-object-store.ts';
import { createSqsQueue } from '../bindings/sqs-queue.ts';
import { createDynamoKvStore } from '../bindings/dynamo-kv-store.ts';

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
// Queue factory — SQS when a URL is configured, Redis fallback otherwise
// ---------------------------------------------------------------------------

function createQueue<T = unknown>(
  region: string,
  redisUrl: string,
  sqsEnvKey: string,
  redisQueueName: string,
) {
  const sqsUrl = optionalEnv(sqsEnvKey);
  if (sqsUrl) {
    return createSqsQueue<T>({
      region,
      queueUrl: sqsUrl,
      accessKeyId: optionalEnv('AWS_ACCESS_KEY_ID'),
      secretAccessKey: optionalEnv('AWS_SECRET_ACCESS_KEY'),
    });
  }
  return createRedisQueue<T>(redisUrl, redisQueueName);
}

// ---------------------------------------------------------------------------
// S3 bucket factory
// ---------------------------------------------------------------------------

function createBucket(region: string, bucketEnvKey: string) {
  const bucket = requireEnv(bucketEnvKey);
  return createS3ObjectStore({
    region,
    bucket,
    accessKeyId: optionalEnv('AWS_ACCESS_KEY_ID'),
    secretAccessKey: optionalEnv('AWS_SECRET_ACCESS_KEY'),
    endpoint: optionalEnv('AWS_S3_ENDPOINT'),
  });
}

// ---------------------------------------------------------------------------
// Web Env
// ---------------------------------------------------------------------------

export async function createTakosAwsWebEnv(): Promise<Env> {
  const region = requireEnv('AWS_REGION');
  const postgresUrl = requireEnv('DATABASE_URL');
  const redisUrl = requireEnv('REDIS_URL');

  const db = await createPostgresD1Database(postgresUrl);

  // Queues: SQS if URLs provided, otherwise fall back to Redis
  const runQueue = createQueue(region, redisUrl, 'AWS_SQS_RUN_QUEUE_URL', 'takos-runs');
  const indexQueue = createQueue(region, redisUrl, 'AWS_SQS_INDEX_QUEUE_URL', 'takos-index');
  const workflowQueue = createQueue(region, redisUrl, 'AWS_SQS_WORKFLOW_QUEUE_URL', 'takos-workflow');
  const deployQueue = createQueue(region, redisUrl, 'AWS_SQS_DEPLOY_QUEUE_URL', 'takos-deploy');

  // Object storage: S3 buckets
  const gitObjects = createBucket(region, 'AWS_S3_GIT_OBJECTS_BUCKET');
  const offload = createBucket(region, 'AWS_S3_OFFLOAD_BUCKET');
  const tenantSource = createBucket(region, 'AWS_S3_TENANT_SOURCE_BUCKET');
  const workerBundles = createBucket(region, 'AWS_S3_WORKER_BUNDLES_BUCKET');
  const tenantBuilds = createBucket(region, 'AWS_S3_TENANT_BUILDS_BUCKET');
  const uiBundles = createBucket(region, 'AWS_S3_UI_BUNDLES_BUCKET');

  // KV: DynamoDB if table configured, otherwise Redis-backed KV is not
  // directly available — use DynamoDB for hostname routing.
  const dynamoTableName = optionalEnv('AWS_DYNAMO_KV_TABLE');
  const hostnameRouting = dynamoTableName
    ? createDynamoKvStore({
        region,
        tableName: dynamoTableName,
        accessKeyId: optionalEnv('AWS_ACCESS_KEY_ID'),
        secretAccessKey: optionalEnv('AWS_SECRET_ACCESS_KEY'),
      })
    : createDynamoKvStore({
        region,
        tableName: requireEnv('AWS_DYNAMO_HOSTNAME_ROUTING_TABLE'),
        accessKeyId: optionalEnv('AWS_ACCESS_KEY_ID'),
        secretAccessKey: optionalEnv('AWS_SECRET_ACCESS_KEY'),
      });

  // Routing store: Redis
  const routingStore = createRedisRoutingStore(redisUrl);

  // Durable Objects: Redis-backed emulation
  const sessionDo = createRedisDurableObjectNamespace(redisUrl, 'session');
  const runNotifier = createRedisDurableObjectNamespace(redisUrl, 'run-notifier');
  const notificationNotifier = createRedisDurableObjectNamespace(redisUrl, 'notification-notifier');
  const gitPushLock = createRedisDurableObjectNamespace(redisUrl, 'git-push-lock');
  const routingDo = createRedisDurableObjectNamespace(redisUrl, 'routing');
  const rateLimiterDo = createRedisDurableObjectNamespace(redisUrl, 'rate-limiter');

  return {
    // Database
    DB: db,

    // Hostname routing (DynamoDB-backed KV)
    HOSTNAME_ROUTING: hostnameRouting,

    // Routing
    ROUTING_DO: routingDo,
    ROUTING_DO_PHASE: optionalEnv('ROUTING_DO_PHASE') ?? '1',
    ROUTING_STORE: routingStore,

    // Durable Object namespaces (Redis-backed)
    SESSION_DO: sessionDo,
    RUN_NOTIFIER: runNotifier,
    NOTIFICATION_NOTIFIER: notificationNotifier,
    GIT_PUSH_LOCK: gitPushLock,
    RATE_LIMITER_DO: rateLimiterDo,

    // Queues
    RUN_QUEUE: runQueue,
    INDEX_QUEUE: indexQueue,
    WORKFLOW_QUEUE: workflowQueue,
    DEPLOY_QUEUE: deployQueue,

    // Object storage (S3-backed)
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
    SERVICE_INTERNAL_JWT_ISSUER: optionalEnv('SERVICE_INTERNAL_JWT_ISSUER') ?? 'takos-aws',
    ENVIRONMENT: optionalEnv('ENVIRONMENT') ?? 'production',

    // AI keys
    OPENAI_API_KEY: optionalEnv('OPENAI_API_KEY'),
    ANTHROPIC_API_KEY: optionalEnv('ANTHROPIC_API_KEY'),
    GOOGLE_API_KEY: optionalEnv('GOOGLE_API_KEY'),
    SERPER_API_KEY: optionalEnv('SERPER_API_KEY'),

    // ECS deployment provider env (read by platform adapter)
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

export async function createTakosAwsDispatchEnv(): Promise<DispatchEnv> {
  const region = requireEnv('AWS_REGION');
  const redisUrl = requireEnv('REDIS_URL');

  // Hostname routing: DynamoDB
  const dynamoTableName = optionalEnv('AWS_DYNAMO_KV_TABLE')
    ?? optionalEnv('AWS_DYNAMO_HOSTNAME_ROUTING_TABLE');
  const hostnameRouting = dynamoTableName
    ? createDynamoKvStore({
        region,
        tableName: dynamoTableName,
        accessKeyId: optionalEnv('AWS_ACCESS_KEY_ID'),
        secretAccessKey: optionalEnv('AWS_SECRET_ACCESS_KEY'),
      })
    : undefined;

  // Routing
  const routingStore = createRedisRoutingStore(redisUrl);
  const routingDo = createRedisDurableObjectNamespace(redisUrl, 'routing');

  return {
    HOSTNAME_ROUTING: hostnameRouting,
    ROUTING_DO: routingDo,
    ROUTING_DO_PHASE: optionalEnv('ROUTING_DO_PHASE') ?? '1',
    ROUTING_STORE: routingStore,
    ADMIN_DOMAIN: optionalEnv('ADMIN_DOMAIN') ?? '',
    // DISPATCHER must be provided externally (e.g. via ECS service mesh or
    // an HTTP-based service registry). The caller is responsible for wiring
    // this before passing the env to createDispatchWorker().
  } as DispatchEnv;
}
