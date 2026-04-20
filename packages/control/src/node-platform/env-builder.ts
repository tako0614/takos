/**
 * Composable Env builder for Node.js platforms.
 *
 * Instead of monolithic per-cloud env creators, this module auto-detects
 * which binding implementation to use for each service category based on
 * the environment variables that are set.  This enables blending backends:
 * e.g. S3 for object storage + Pub/Sub for queues + PostgreSQL for DB.
 *
 * Detection priority per category (first match wins):
 *
 *   Database:       DATABASE_URL / POSTGRES_URL -> Postgres
 *                   TAKOS_LOCAL_DATA_DIR         -> SQLite
 *                   else                         -> in-memory D1
 *
 *   Object Storage: AWS_S3_{NAME}_BUCKET         -> S3 (+ AWS_S3_ENDPOINT for MinIO)
 *     (per-bucket)  GCP_GCS_{NAME}_BUCKET        -> GCS
 *                   TAKOS_LOCAL_DATA_DIR          -> persistent R2
 *                   else                          -> in-memory R2
 *
 *   Queues:         AWS_SQS_{NAME}_QUEUE_URL     -> SQS
 *     (per-queue)   GCP_PUBSUB_{NAME}_TOPIC      -> Pub/Sub
 *                     + GCP_PUBSUB_{NAME}_SUBSCRIPTION (enables receive)
 *                   REDIS_URL                     -> Redis queue
 *                   TAKOS_LOCAL_DATA_DIR          -> persistent queue
 *                   else                          -> in-memory queue
 *
 *   KV:             AWS_DYNAMO_KV_TABLE           -> DynamoDB
 *                   GCP_FIRESTORE_KV_COLLECTION   -> Firestore
 *                   TAKOS_LOCAL_DATA_DIR          -> persistent KV
 *                   else                          -> in-memory KV
 *
 *   Durable Objs:   REDIS_URL                    -> Redis-backed
 *                   TAKOS_LOCAL_DATA_DIR          -> persistent
 *                   else                          -> in-memory
 *
 *   Routing Store:  REDIS_URL                    -> Redis
 *                   TAKOS_LOCAL_DATA_DIR          -> persistent
 *                   else                          -> in-memory
 *
 *   AI (embeddings): OPENAI_API_KEY               -> OpenAI embeddings adapter
 *                    else                          -> disabled
 *
 *   Vectorize:      PGVECTOR_ENABLED=true + PG    -> pgvector store
 *                   else                           -> disabled
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Env } from "../shared/types/index.ts";
import type { DispatchEnv } from "../dispatch.ts";
import { disposeRedisClient } from "../local-platform/redis-bindings.ts";
import { removeLocalDataDir } from "../local-platform/persistent-bindings.ts";
import type { TenantWorkerRuntimeRegistry } from "../local-platform/tenant-worker-runtime.ts";

import { DEFAULT_LOCAL_DOMAINS } from "../local-platform/runtime-types.ts";

// -- Resolvers ----------------------------------------------------------------
import {
  optionalEnv,
  resolveLocalDataDir,
  resolvePostgresUrl,
  resolveRedisUrl,
} from "./resolvers/env-utils.ts";
import { resolveDatabase } from "./resolvers/db-resolver.ts";
import { resolveBucket } from "./resolvers/bucket-resolver.ts";
import { resolveQueue } from "./resolvers/queue-resolver.ts";
import { resolveKvStore } from "./resolvers/kv-resolver.ts";
import { resolveDurableObject } from "./resolvers/durable-object-resolver.ts";
import {
  resolveAiBinding,
  resolvePgPool,
  resolveVectorizeBinding,
} from "./resolvers/ai-resolver.ts";
import {
  ensureRoutingSeeded,
  resetRoutingSeed,
  resolveRoutingStore,
  resolveSseNotifier,
} from "./resolvers/routing-resolver.ts";
import {
  buildDispatcher,
  collectImplicitForwardTargets,
} from "./resolvers/dispatch-resolver.ts";

// ---------------------------------------------------------------------------
// Local development placeholder defaults
// ---------------------------------------------------------------------------

export const LOCAL_DEV_DEFAULTS = {
  GOOGLE_CLIENT_ID: "local-google-client",
  GOOGLE_CLIENT_SECRET: "local-google-secret",
  PLATFORM_PRIVATE_KEY: "local-platform-private-key",
  PLATFORM_PUBLIC_KEY: "local-platform-public-key",
  ENCRYPTION_KEY: "local-encryption-key",
  EXECUTOR_PROXY_SECRET: "local-executor-proxy-secret",
} as const;

/**
 * Default ROUTING_DO_PHASE for the Node / local platform.
 *
 * Local dev uses phase 1 (basic KV-only routing) for simplicity.
 * Production (wrangler.toml) uses phase 4 (full DO-based routing).
 * This difference is intentional -- phase 4 requires Durable Object
 * bindings that are only available in the Cloudflare Workers runtime.
 */
const DEFAULT_ROUTING_DO_PHASE = "1";

// ---------------------------------------------------------------------------
// Shared state (lazy singleton)
// ---------------------------------------------------------------------------

type SharedState = Awaited<ReturnType<typeof buildSharedState>>;

async function buildSharedState() {
  const dataDir = resolveLocalDataDir();
  const redisUrl = resolveRedisUrl();
  const postgresUrl = resolvePostgresUrl();
  const packageDir = path.dirname(fileURLToPath(import.meta.url));
  const migrationsDir = path.resolve(
    packageDir,
    "../../../../apps/control/db/migrations",
  );

  const db = await resolveDatabase(postgresUrl, dataDir, migrationsDir);
  const hostnameRouting = await resolveKvStore(dataDir);
  const routingStore = resolveRoutingStore(redisUrl, dataDir);

  const routingDo = resolveDurableObject("routing", redisUrl, dataDir);
  const sessionDo = resolveDurableObject("session", redisUrl, dataDir);
  const runNotifier = resolveDurableObject("run-notifier", redisUrl, dataDir);
  const notificationNotifier = resolveDurableObject(
    "notification-notifier",
    redisUrl,
    dataDir,
  );
  const gitPushLock = resolveDurableObject("git-push-lock", redisUrl, dataDir);
  const rateLimiterDo = resolveDurableObject("rate-limiter", redisUrl, dataDir);

  const runQueue = await resolveQueue("RUN", redisUrl, dataDir);
  const indexQueue = await resolveQueue("INDEX", redisUrl, dataDir);
  const workflowQueue = await resolveQueue("WORKFLOW", redisUrl, dataDir);
  const deployQueue = await resolveQueue("DEPLOY", redisUrl, dataDir);

  const pgPool = await resolvePgPool(postgresUrl);

  const [
    gitObjects,
    offload,
    tenantSource,
    workerBundles,
    tenantBuilds,
    aiBinding,
    vectorizeBinding,
  ] = await Promise.all([
    resolveBucket("GIT_OBJECTS", dataDir),
    resolveBucket("TAKOS_OFFLOAD", dataDir),
    resolveBucket("TENANT_SOURCE", dataDir),
    resolveBucket("WORKER_BUNDLES", dataDir),
    resolveBucket("TENANT_BUILDS", dataDir),
    resolveAiBinding(),
    resolveVectorizeBinding(pgPool),
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
    aiBinding,
    vectorizeBinding,
    pgPool,
    sseNotifier: await resolveSseNotifier(redisUrl),
  };
}

let sharedPromise: Promise<SharedState> | null = null;
const dispatchRegistries = new Set<TenantWorkerRuntimeRegistry>();

function getSharedState(): Promise<SharedState> {
  if (!sharedPromise) {
    sharedPromise = buildSharedState().catch((error) => {
      sharedPromise = null;
      throw error;
    });
  }
  return sharedPromise;
}

// ---------------------------------------------------------------------------
// Build config helpers
// ---------------------------------------------------------------------------

function optionalCloudflareEnv(preferred: string, fallback: string) {
  return optionalEnv(preferred) ?? optionalEnv(fallback);
}

function optionalJsonArrayEnv(name: string): string | undefined {
  const value = optionalEnv(name);
  if (!value?.trim()) return value;
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch (error) {
    throw new Error(`${name} must be valid JSON`, { cause: error });
  }
  if (!Array.isArray(parsed)) {
    throw new Error(`${name} must be a JSON array`);
  }
  return value;
}

function buildBaseConfig(isLocal: boolean) {
  return {
    ADMIN_DOMAIN: optionalEnv("ADMIN_DOMAIN") ??
      (isLocal ? DEFAULT_LOCAL_DOMAINS.admin : ""),
    TENANT_BASE_DOMAIN: optionalEnv("TENANT_BASE_DOMAIN") ??
      (isLocal ? DEFAULT_LOCAL_DOMAINS.tenantBase : ""),
    GOOGLE_CLIENT_ID: optionalEnv("GOOGLE_CLIENT_ID") ??
      (isLocal ? LOCAL_DEV_DEFAULTS.GOOGLE_CLIENT_ID : ""),
    GOOGLE_CLIENT_SECRET: optionalEnv("GOOGLE_CLIENT_SECRET") ??
      (isLocal ? LOCAL_DEV_DEFAULTS.GOOGLE_CLIENT_SECRET : ""),
    PLATFORM_PRIVATE_KEY: optionalEnv("PLATFORM_PRIVATE_KEY") ??
      (isLocal ? LOCAL_DEV_DEFAULTS.PLATFORM_PRIVATE_KEY : ""),
    PLATFORM_PUBLIC_KEY: optionalEnv("PLATFORM_PUBLIC_KEY") ??
      (isLocal ? LOCAL_DEV_DEFAULTS.PLATFORM_PUBLIC_KEY : ""),
    // Operator input prefers CLOUDFLARE_*; runtime bindings keep CF_* names.
    CF_ACCOUNT_ID: optionalCloudflareEnv(
      "CLOUDFLARE_ACCOUNT_ID",
      "CF_ACCOUNT_ID",
    ),
    CF_API_TOKEN: optionalCloudflareEnv(
      "CLOUDFLARE_API_TOKEN",
      "CF_API_TOKEN",
    ),
    CF_ZONE_ID: optionalEnv("CF_ZONE_ID"),
    WFP_DISPATCH_NAMESPACE: optionalEnv("WFP_DISPATCH_NAMESPACE"),
    ENCRYPTION_KEY: optionalEnv("ENCRYPTION_KEY") ??
      (isLocal ? LOCAL_DEV_DEFAULTS.ENCRYPTION_KEY : ""),
    EXECUTOR_PROXY_SECRET: optionalEnv("EXECUTOR_PROXY_SECRET") ??
      (isLocal ? LOCAL_DEV_DEFAULTS.EXECUTOR_PROXY_SECRET : ""),
    SERVICE_INTERNAL_JWT_ISSUER: optionalEnv("SERVICE_INTERNAL_JWT_ISSUER") ??
      "takos-node",
    ENVIRONMENT: optionalEnv("ENVIRONMENT") ??
      (isLocal ? "development" : "production"),
    ROUTING_DO_PHASE: optionalEnv("ROUTING_DO_PHASE") ??
      DEFAULT_ROUTING_DO_PHASE,
    TAKOS_DEFAULT_APP_DISTRIBUTION_JSON: optionalJsonArrayEnv(
      "TAKOS_DEFAULT_APP_DISTRIBUTION_JSON",
    ),
    TAKOS_DEFAULT_APP_REPOSITORIES_JSON: optionalJsonArrayEnv(
      "TAKOS_DEFAULT_APP_REPOSITORIES_JSON",
    ),
    TAKOS_DEFAULT_APPS_PREINSTALL: optionalEnv(
      "TAKOS_DEFAULT_APPS_PREINSTALL",
    ),
    TAKOS_DEFAULT_APP_REF: optionalEnv("TAKOS_DEFAULT_APP_REF"),
    TAKOS_DEFAULT_APP_REF_TYPE: optionalEnv("TAKOS_DEFAULT_APP_REF_TYPE"),
    TAKOS_DEFAULT_APP_BACKEND: optionalEnv("TAKOS_DEFAULT_APP_BACKEND"),
    TAKOS_DEFAULT_APP_ENV: optionalEnv("TAKOS_DEFAULT_APP_ENV"),
    TAKOS_DEFAULT_DOCS_APP_REPOSITORY_URL: optionalEnv(
      "TAKOS_DEFAULT_DOCS_APP_REPOSITORY_URL",
    ),
    TAKOS_DEFAULT_EXCEL_APP_REPOSITORY_URL: optionalEnv(
      "TAKOS_DEFAULT_EXCEL_APP_REPOSITORY_URL",
    ),
    TAKOS_DEFAULT_SLIDE_APP_REPOSITORY_URL: optionalEnv(
      "TAKOS_DEFAULT_SLIDE_APP_REPOSITORY_URL",
    ),
    TAKOS_INTERNAL_API_SECRET: optionalEnv("TAKOS_INTERNAL_API_SECRET"),
  } as const;
}

/**
 * Shared preamble: ensure routing is seeded, resolve shared state, build config.
 * Used by both createNodeWebEnv and createNodeDispatchEnv to avoid repeating
 * the same three-step initialization sequence.
 */
async function getInitializedState() {
  await ensureRoutingSeeded(getSharedState);
  const shared = await getSharedState();
  const config = buildBaseConfig(shared.dataDir !== null);
  return { shared, config };
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

/** Options for {@link disposeNodePlatformState}. */
export interface DisposeOptions {
  /** If true, also delete the local data directory on disk. */
  clearData?: boolean;
}

/**
 * Tear down the shared singleton state, closing DB connections, Redis
 * clients, and dispatch registries.
 *
 * Pass `{ clearData: true }` to also remove the local data directory
 * (equivalent to the old clearNodePlatformDataForTests).
 */
export async function disposeNodePlatformState(
  opts?: DisposeOptions,
): Promise<void> {
  const pendingState = sharedPromise;
  sharedPromise = null;
  resetRoutingSeed();
  const state = pendingState
    ? await pendingState.catch(() => null /* dispose: init may have failed */)
    : null;
  if (state) {
    await Promise.resolve(
      (state.db as typeof state.db & { close?: () => Promise<void> | void })
        .close?.(),
    )
      .catch(() =>
        undefined /* dispose: db close is best-effort during teardown */
      );
  }
  await Promise.all(
    Array.from(
      dispatchRegistries,
      (registry) =>
        registry.dispose().catch(() =>
          undefined /* dispose: registry teardown is best-effort */
        ),
    ),
  );
  dispatchRegistries.clear();
  await disposeRedisClient();

  if (opts?.clearData) {
    const dataDir = resolveLocalDataDir();
    if (dataDir) {
      await removeLocalDataDir(dataDir);
    }
  }
}

/** @deprecated Use {@link disposeNodePlatformState} directly. */
export async function resetNodePlatformStateForTests(): Promise<void> {
  await disposeNodePlatformState();
}

/** @deprecated Use `disposeNodePlatformState({ clearData: true })`. */
export async function clearNodePlatformDataForTests(): Promise<void> {
  const dataDir = resolveLocalDataDir();
  if (!dataDir) return;
  await removeLocalDataDir(dataDir);
}

// ---------------------------------------------------------------------------
// Public: createNodeWebEnv
// ---------------------------------------------------------------------------

export async function createNodeWebEnv(): Promise<Env> {
  const { shared, config } = await getInitializedState();

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
    OCI_ORCHESTRATOR_URL: optionalEnv("OCI_ORCHESTRATOR_URL"),
    OCI_ORCHESTRATOR_TOKEN: optionalEnv("OCI_ORCHESTRATOR_TOKEN"),
    AWS_REGION: optionalEnv("AWS_REGION"),
    AWS_ECS_REGION: optionalEnv("AWS_ECS_REGION"),
    AWS_ECS_CLUSTER_ARN: optionalEnv("AWS_ECS_CLUSTER_ARN"),
    AWS_ECS_TASK_DEFINITION_FAMILY: optionalEnv(
      "AWS_ECS_TASK_DEFINITION_FAMILY",
    ),
    AWS_ECS_SERVICE_ARN: optionalEnv("AWS_ECS_SERVICE_ARN"),
    AWS_ECS_SERVICE_NAME: optionalEnv("AWS_ECS_SERVICE_NAME"),
    AWS_ECS_CONTAINER_NAME: optionalEnv("AWS_ECS_CONTAINER_NAME"),
    AWS_ECS_SUBNET_IDS: optionalEnv("AWS_ECS_SUBNET_IDS"),
    AWS_ECS_SECURITY_GROUP_IDS: optionalEnv("AWS_ECS_SECURITY_GROUP_IDS"),
    AWS_ECS_ASSIGN_PUBLIC_IP: optionalEnv("AWS_ECS_ASSIGN_PUBLIC_IP"),
    AWS_ECS_LAUNCH_TYPE: optionalEnv("AWS_ECS_LAUNCH_TYPE"),
    AWS_ECS_DESIRED_COUNT: optionalEnv("AWS_ECS_DESIRED_COUNT"),
    AWS_ECS_BASE_URL: optionalEnv("AWS_ECS_BASE_URL"),
    AWS_ECS_HEALTH_URL: optionalEnv("AWS_ECS_HEALTH_URL"),
    AWS_ECR_REPOSITORY_URI: optionalEnv("AWS_ECR_REPOSITORY_URI"),
    GCP_PROJECT_ID: optionalEnv("GCP_PROJECT_ID"),
    GCP_REGION: optionalEnv("GCP_REGION"),
    GCP_CLOUD_RUN_REGION: optionalEnv("GCP_CLOUD_RUN_REGION"),
    GCP_CLOUD_RUN_SERVICE_ID: optionalEnv("GCP_CLOUD_RUN_SERVICE_ID"),
    GCP_CLOUD_RUN_SERVICE_ACCOUNT: optionalEnv("GCP_CLOUD_RUN_SERVICE_ACCOUNT"),
    GCP_CLOUD_RUN_INGRESS: optionalEnv("GCP_CLOUD_RUN_INGRESS"),
    GCP_CLOUD_RUN_ALLOW_UNAUTHENTICATED: optionalEnv(
      "GCP_CLOUD_RUN_ALLOW_UNAUTHENTICATED",
    ),
    GCP_CLOUD_RUN_BASE_URL: optionalEnv("GCP_CLOUD_RUN_BASE_URL"),
    GCP_CLOUD_RUN_DELETE_ON_REMOVE: optionalEnv(
      "GCP_CLOUD_RUN_DELETE_ON_REMOVE",
    ),
    GCP_ARTIFACT_REGISTRY_REPO: optionalEnv("GCP_ARTIFACT_REGISTRY_REPO"),
    K8S_NAMESPACE: optionalEnv("K8S_NAMESPACE"),
    K8S_DEPLOYMENT_NAME: optionalEnv("K8S_DEPLOYMENT_NAME"),
    K8S_IMAGE_REGISTRY: optionalEnv("K8S_IMAGE_REGISTRY"),
    ENCRYPTION_KEY: config.ENCRYPTION_KEY,
    EXECUTOR_PROXY_SECRET: config.EXECUTOR_PROXY_SECRET,
    SERVICE_INTERNAL_JWT_ISSUER: config.SERVICE_INTERNAL_JWT_ISSUER,
    ENVIRONMENT: config.ENVIRONMENT,
    TAKOS_DEFAULT_APP_DISTRIBUTION_JSON:
      config.TAKOS_DEFAULT_APP_DISTRIBUTION_JSON,
    TAKOS_DEFAULT_APP_REPOSITORIES_JSON:
      config.TAKOS_DEFAULT_APP_REPOSITORIES_JSON,
    TAKOS_DEFAULT_APPS_PREINSTALL: config.TAKOS_DEFAULT_APPS_PREINSTALL,
    TAKOS_DEFAULT_APP_REF: config.TAKOS_DEFAULT_APP_REF,
    TAKOS_DEFAULT_APP_REF_TYPE: config.TAKOS_DEFAULT_APP_REF_TYPE,
    TAKOS_DEFAULT_APP_BACKEND: config.TAKOS_DEFAULT_APP_BACKEND,
    TAKOS_DEFAULT_APP_ENV: config.TAKOS_DEFAULT_APP_ENV,
    TAKOS_DEFAULT_DOCS_APP_REPOSITORY_URL:
      config.TAKOS_DEFAULT_DOCS_APP_REPOSITORY_URL,
    TAKOS_DEFAULT_EXCEL_APP_REPOSITORY_URL:
      config.TAKOS_DEFAULT_EXCEL_APP_REPOSITORY_URL,
    TAKOS_DEFAULT_SLIDE_APP_REPOSITORY_URL:
      config.TAKOS_DEFAULT_SLIDE_APP_REPOSITORY_URL,
    TAKOS_INTERNAL_API_SECRET: config.TAKOS_INTERNAL_API_SECRET,
    AI: shared.aiBinding,
    VECTORIZE: shared.vectorizeBinding,
    OPENAI_API_KEY: optionalEnv("OPENAI_API_KEY"),
    ANTHROPIC_API_KEY: optionalEnv("ANTHROPIC_API_KEY"),
    GOOGLE_API_KEY: optionalEnv("GOOGLE_API_KEY"),
    SERPER_API_KEY: optionalEnv("SERPER_API_KEY"),
    BILLING_PROCESSOR: optionalEnv("BILLING_PROCESSOR"),
    STRIPE_SECRET_KEY: optionalEnv("STRIPE_SECRET_KEY"),
    STRIPE_WEBHOOK_SECRET: optionalEnv("STRIPE_WEBHOOK_SECRET"),
    STRIPE_PLUS_PRICE_ID: optionalEnv("STRIPE_PLUS_PRICE_ID"),
    STRIPE_PRO_TOPUP_PACKS_JSON: optionalEnv("STRIPE_PRO_TOPUP_PACKS_JSON"),
    TURNSTILE_SECRET_KEY: optionalEnv("TURNSTILE_SECRET_KEY"),
    AUDIT_IP_HASH_KEY: optionalEnv("AUDIT_IP_HASH_KEY"),
    // SSE notifier is a Node-only service, not part of the CF Workers Env type.
    // Passed via env as an opaque property; accessed by the node platform adapter.
    ...(shared.sseNotifier ? { SSE_NOTIFIER: shared.sseNotifier } : {}),
  } as Env;
}

// ---------------------------------------------------------------------------
// Public: createNodeDispatchEnv
// ---------------------------------------------------------------------------

export async function createNodeDispatchEnv(): Promise<DispatchEnv> {
  const { shared, config } = await getInitializedState();

  const dispatcher = await buildDispatcher({
    dataDir: shared.dataDir,
    db: shared.db,
    workerBundles: shared.workerBundles,
    encryptionKey: config.ENCRYPTION_KEY,
    pgPool: shared.pgPool,
    forwardTargets: { ...collectImplicitForwardTargets() },
    dispatchRegistries,
  });

  return {
    HOSTNAME_ROUTING: shared.hostnameRouting,
    ROUTING_DO: shared.routingDo,
    ROUTING_DO_PHASE: config.ROUTING_DO_PHASE,
    ROUTING_STORE: shared.routingStore,
    ADMIN_DOMAIN: config.ADMIN_DOMAIN,
    DISPATCHER: dispatcher,
  };
}
