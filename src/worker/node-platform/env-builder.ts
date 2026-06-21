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
 *                   else                         -> in-memory SQL
 *
 *   Object Storage: AWS_S3_{NAME}_BUCKET         -> S3 (+ AWS_S3_ENDPOINT for MinIO)
 *     (per-bucket)  GCP_GCS_{NAME}_BUCKET        -> GCS
 *                   TAKOS_LOCAL_DATA_DIR          -> persistent object store
 *                   else                          -> in-memory object store
 *
 *   Message queue:  AWS_SQS_{NAME}_QUEUE_URL     -> SQS
 *     (per-name)    GCP_PUBSUB_{NAME}_TOPIC      -> Pub/Sub
 *                     + GCP_PUBSUB_{NAME}_SUBSCRIPTION (enables receive)
 *                   REDIS_URL                     -> Redis message queue
 *                   TAKOS_LOCAL_DATA_DIR          -> persistent message queue
 *                   else                          -> in-memory message queue
 *
 *   Key-value:      AWS_DYNAMO_KV_TABLE           -> DynamoDB
 *                   GCP_FIRESTORE_KV_COLLECTION   -> Firestore
 *                   TAKOS_LOCAL_DATA_DIR          -> persistent kv store
 *                   else                          -> in-memory kv store
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
import type {
  DurableNamespaceBinding,
  KvStoreBinding,
} from "../shared/types/bindings.ts";
import type { RoutingStore } from "../shared/types/routing.ts";
import { disposeRedisClient } from "../local-platform/redis-bindings.ts";
import { removeLocalDataDir } from "../local-platform/persistent-bindings.ts";
import type { TenantWorkerRuntimeRegistry } from "../local-platform/tenant-worker-runtime.ts";

import {
  DEFAULT_LOCAL_DOMAINS,
  DEFAULT_LOCAL_PORTS,
} from "../local-platform/runtime-types.ts";

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
  OIDC_ISSUER_URL: `http://${DEFAULT_LOCAL_DOMAINS.admin}:${DEFAULT_LOCAL_PORTS.web}`,
  OIDC_CLIENT_ID: "local-oidc-client",
  OIDC_CLIENT_SECRET: "local-oidc-secret",
  PLATFORM_PRIVATE_KEY: "local-platform-private-key",
  PLATFORM_PUBLIC_KEY: "local-platform-public-key",
  ENCRYPTION_KEY: "local-encryption-key",
  EXECUTOR_PROXY_SECRET: "local-executor-proxy-secret",
} as const;

// ---------------------------------------------------------------------------
// Shared state (lazy singleton)
// ---------------------------------------------------------------------------

type SharedState = Awaited<ReturnType<typeof buildSharedState>>;

type NodeDispatchEnv = {
  HOSTNAME_ROUTING?: KvStoreBinding;
  ROUTING_DO?: DurableNamespaceBinding;
  ROUTING_STORE?: RoutingStore;
  DISPATCHER: {
    get(name: string): { fetch(request: Request): Promise<Response> };
  };
  ADMIN_DOMAIN: string;
};

async function buildSharedState() {
  const dataDir = resolveLocalDataDir();
  const redisUrl = resolveRedisUrl();
  const postgresUrl = resolvePostgresUrl();
  const packageDir = path.dirname(fileURLToPath(import.meta.url));
  const migrationsDir = path.resolve(
    packageDir,
    "../../../db/migrations-control/migrations",
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
    ADMIN_DOMAIN:
      optionalEnv("ADMIN_DOMAIN") ??
      (isLocal ? DEFAULT_LOCAL_DOMAINS.admin : ""),
    TAKOS_INTERNAL_API_URL: optionalEnv("TAKOS_INTERNAL_API_URL"),
    TENANT_BASE_DOMAIN:
      optionalEnv("TENANT_BASE_DOMAIN") ??
      (isLocal ? DEFAULT_LOCAL_DOMAINS.tenantBase : ""),
    OIDC_ISSUER_URL:
      optionalEnv("OIDC_ISSUER_URL") ??
      (isLocal ? LOCAL_DEV_DEFAULTS.OIDC_ISSUER_URL : ""),
    OIDC_DISCOVERY_URL: optionalEnv("OIDC_DISCOVERY_URL"),
    TAKOSUMI_ACCOUNTS_INTERNAL_URL: optionalEnv(
      "TAKOSUMI_ACCOUNTS_INTERNAL_URL",
    ),
    TAKOSUMI_ACCOUNTS_URL: optionalEnv("TAKOSUMI_ACCOUNTS_URL"),
    TAKOSUMI_ACCOUNTS_TOKEN: optionalEnv("TAKOSUMI_ACCOUNTS_TOKEN"),
    OIDC_CLIENT_ID:
      optionalEnv("OIDC_CLIENT_ID") ??
      (isLocal ? LOCAL_DEV_DEFAULTS.OIDC_CLIENT_ID : ""),
    OIDC_CLIENT_SECRET:
      optionalEnv("OIDC_CLIENT_SECRET") ??
      (isLocal ? LOCAL_DEV_DEFAULTS.OIDC_CLIENT_SECRET : ""),
    OIDC_REDIRECT_URI: optionalEnv("OIDC_REDIRECT_URI"),
    PLATFORM_PRIVATE_KEY:
      optionalEnv("PLATFORM_PRIVATE_KEY") ??
      (isLocal ? LOCAL_DEV_DEFAULTS.PLATFORM_PRIVATE_KEY : ""),
    PLATFORM_PUBLIC_KEY:
      optionalEnv("PLATFORM_PUBLIC_KEY") ??
      (isLocal ? LOCAL_DEV_DEFAULTS.PLATFORM_PUBLIC_KEY : ""),
    CF_ACCOUNT_ID: optionalEnv("CF_ACCOUNT_ID"),
    CF_API_TOKEN: optionalEnv("CF_API_TOKEN"),
    CF_ZONE_ID: optionalEnv("CF_ZONE_ID"),
    TAKOS_CUSTOM_DOMAIN_TLS_PROVIDER: optionalEnv(
      "TAKOS_CUSTOM_DOMAIN_TLS_PROVIDER",
    ),
    WFP_DISPATCH_NAMESPACE: optionalEnv("WFP_DISPATCH_NAMESPACE"),
    ENCRYPTION_KEY:
      optionalEnv("ENCRYPTION_KEY") ??
      (isLocal ? LOCAL_DEV_DEFAULTS.ENCRYPTION_KEY : ""),
    EXECUTOR_PROXY_SECRET:
      optionalEnv("EXECUTOR_PROXY_SECRET") ??
      (isLocal ? LOCAL_DEV_DEFAULTS.EXECUTOR_PROXY_SECRET : ""),
    SERVICE_INTERNAL_JWT_ISSUER:
      optionalEnv("SERVICE_INTERNAL_JWT_ISSUER") ?? "takos-node",
    ENVIRONMENT:
      optionalEnv("ENVIRONMENT") ?? (isLocal ? "development" : "production"),
    TAKOS_DEFAULT_APP_DISTRIBUTION_JSON: optionalJsonArrayEnv(
      "TAKOS_DEFAULT_APP_DISTRIBUTION_JSON",
    ),
    TAKOS_DEFAULT_APP_REPOSITORIES_JSON: optionalJsonArrayEnv(
      "TAKOS_DEFAULT_APP_REPOSITORIES_JSON",
    ),
    TAKOS_DEFAULT_APPS_PREINSTALL: optionalEnv("TAKOS_DEFAULT_APPS_PREINSTALL"),
    TAKOS_DEFAULT_APP_REF: optionalEnv("TAKOS_DEFAULT_APP_REF"),
    TAKOS_DEFAULT_APP_REF_TYPE: optionalEnv("TAKOS_DEFAULT_APP_REF_TYPE"),
    TAKOS_DEFAULT_APP_BACKEND: optionalEnv("TAKOS_DEFAULT_APP_BACKEND"),
    TAKOS_DEFAULT_APP_ENV: optionalEnv("TAKOS_DEFAULT_APP_ENV"),
    TAKOS_DEFAULT_APP_INSTALL_URL: optionalEnv("TAKOS_DEFAULT_APP_INSTALL_URL"),
    TAKOS_DEFAULT_APP_INSTALL_TOKEN: optionalEnv(
      "TAKOS_DEFAULT_APP_INSTALL_TOKEN",
    ),
    TAKOS_DEFAULT_APP_INSTALL_ACCOUNT_ID: optionalEnv(
      "TAKOS_DEFAULT_APP_INSTALL_ACCOUNT_ID",
    ),
    TAKOS_DEFAULT_APP_INSTALL_SUBJECT: optionalEnv(
      "TAKOS_DEFAULT_APP_INSTALL_SUBJECT",
    ),
    TAKOS_DEFAULT_APP_INSTALL_MODE: optionalEnv(
      "TAKOS_DEFAULT_APP_INSTALL_MODE",
    ),
    TAKOS_DEFAULT_APP_INSTALL_RUNTIME_BASE_URL: optionalEnv(
      "TAKOS_DEFAULT_APP_INSTALL_RUNTIME_BASE_URL",
    ),
    TAKOS_APP_INSTALLATIONS_URL: optionalEnv("TAKOS_APP_INSTALLATIONS_URL"),
    TAKOS_APP_INSTALL_TOKEN: optionalEnv("TAKOS_APP_INSTALL_TOKEN"),
    TAKOS_APP_INSTALL_ACCOUNT_ID: optionalEnv("TAKOS_APP_INSTALL_ACCOUNT_ID"),
    TAKOS_APP_INSTALL_SUBJECT: optionalEnv("TAKOS_APP_INSTALL_SUBJECT"),
    TAKOS_APP_INSTALL_MODE: optionalEnv("TAKOS_APP_INSTALL_MODE"),
    TAKOS_APP_INSTALL_RUNTIME_BASE_URL: optionalEnv(
      "TAKOS_APP_INSTALL_RUNTIME_BASE_URL",
    ),
    TAKOS_DEFAULT_OFFICE_APP_REPOSITORY_URL: optionalEnv(
      "TAKOS_DEFAULT_OFFICE_APP_REPOSITORY_URL",
    ),
    TAKOS_DEFAULT_COMPUTER_APP_REPOSITORY_URL: optionalEnv(
      "TAKOS_DEFAULT_COMPUTER_APP_REPOSITORY_URL",
    ),
    TAKOS_DEFAULT_YURUCOMMU_APP_REPOSITORY_URL: optionalEnv(
      "TAKOS_DEFAULT_YURUCOMMU_APP_REPOSITORY_URL",
    ),
    TAKOS_DEFAULT_ROAD_TO_ME_APP_REPOSITORY_URL: optionalEnv(
      "TAKOS_DEFAULT_ROAD_TO_ME_APP_REPOSITORY_URL",
    ),
    TAKOS_INTERNAL_API_SECRET: optionalEnv("TAKOS_INTERNAL_API_SECRET"),
  } as const;
}

type BaseConfig = ReturnType<typeof buildBaseConfig>;

function assertSelfHostedProductionConfig(config: BaseConfig): void {
  if (config.ENVIRONMENT !== "production" || !resolveLocalDataDir()) return;

  const invalid: string[] = [];
  const requireExplicit = (
    name: string,
    value: string | undefined,
    localDefault?: string,
  ) => {
    if (!value?.trim() || value === localDefault) invalid.push(name);
  };

  requireExplicit(
    "ADMIN_DOMAIN",
    config.ADMIN_DOMAIN,
    DEFAULT_LOCAL_DOMAINS.admin,
  );
  requireExplicit(
    "TENANT_BASE_DOMAIN",
    config.TENANT_BASE_DOMAIN,
    DEFAULT_LOCAL_DOMAINS.tenantBase,
  );
  requireExplicit(
    "OIDC_ISSUER_URL",
    config.OIDC_ISSUER_URL,
    LOCAL_DEV_DEFAULTS.OIDC_ISSUER_URL,
  );
  requireExplicit(
    "OIDC_CLIENT_ID",
    config.OIDC_CLIENT_ID,
    LOCAL_DEV_DEFAULTS.OIDC_CLIENT_ID,
  );
  requireExplicit(
    "OIDC_CLIENT_SECRET",
    config.OIDC_CLIENT_SECRET,
    LOCAL_DEV_DEFAULTS.OIDC_CLIENT_SECRET,
  );
  requireExplicit(
    "PLATFORM_PRIVATE_KEY",
    config.PLATFORM_PRIVATE_KEY,
    LOCAL_DEV_DEFAULTS.PLATFORM_PRIVATE_KEY,
  );
  requireExplicit(
    "PLATFORM_PUBLIC_KEY",
    config.PLATFORM_PUBLIC_KEY,
    LOCAL_DEV_DEFAULTS.PLATFORM_PUBLIC_KEY,
  );
  requireExplicit(
    "ENCRYPTION_KEY",
    config.ENCRYPTION_KEY,
    LOCAL_DEV_DEFAULTS.ENCRYPTION_KEY,
  );
  requireExplicit(
    "EXECUTOR_PROXY_SECRET",
    config.EXECUTOR_PROXY_SECRET,
    LOCAL_DEV_DEFAULTS.EXECUTOR_PROXY_SECRET,
  );

  if (invalid.length > 0) {
    throw new Error(
      `Self-hosted production requires explicit non-local values for: ${invalid.join(
        ", ",
      )}`,
    );
  }
}

/**
 * Shared preamble: ensure routing is seeded, resolve shared state, build config.
 * Used by both createNodeWebEnv and createNodeDispatchEnv to avoid repeating
 * the same three-step initialization sequence.
 */
async function getInitializedState() {
  const config = buildBaseConfig(resolveLocalDataDir() !== null);
  assertSelfHostedProductionConfig(config);
  await ensureRoutingSeeded(getSharedState);
  const shared = await getSharedState();
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
 * Pass `{ clearData: true }` to also remove the local data directory.
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
      (
        state.db as typeof state.db & { close?: () => Promise<void> | void }
      ).close?.(),
    ).catch(
      () => undefined /* dispose: db close is best-effort during teardown */,
    );
  }
  await Promise.all(
    Array.from(dispatchRegistries, (registry) =>
      registry
        .dispose()
        .catch(() => undefined /* dispose: registry teardown is best-effort */),
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

// ---------------------------------------------------------------------------
// Public: createNodeWebEnv
// ---------------------------------------------------------------------------

export async function createNodeWebEnv(): Promise<Env> {
  const { shared, config } = await getInitializedState();

  return {
    DB: shared.db,
    HOSTNAME_ROUTING: shared.hostnameRouting,
    ROUTING_DO: shared.routingDo,
    ROUTING_STORE: shared.routingStore,
    SESSION_DO: shared.sessionDo,
    RUN_NOTIFIER: shared.runNotifier,
    NOTIFICATION_NOTIFIER: shared.notificationNotifier,
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
    OIDC_ISSUER_URL: config.OIDC_ISSUER_URL,
    OIDC_DISCOVERY_URL: config.OIDC_DISCOVERY_URL,
    TAKOSUMI_ACCOUNTS_INTERNAL_URL: config.TAKOSUMI_ACCOUNTS_INTERNAL_URL,
    TAKOSUMI_ACCOUNTS_URL: config.TAKOSUMI_ACCOUNTS_URL,
    TAKOSUMI_ACCOUNTS_TOKEN: config.TAKOSUMI_ACCOUNTS_TOKEN,
    OIDC_CLIENT_ID: config.OIDC_CLIENT_ID,
    OIDC_CLIENT_SECRET: config.OIDC_CLIENT_SECRET,
    OIDC_REDIRECT_URI: config.OIDC_REDIRECT_URI,
    ADMIN_DOMAIN: config.ADMIN_DOMAIN,
    TAKOS_INTERNAL_API_URL: config.TAKOS_INTERNAL_API_URL,
    TENANT_BASE_DOMAIN: config.TENANT_BASE_DOMAIN,
    PLATFORM_PRIVATE_KEY: config.PLATFORM_PRIVATE_KEY,
    PLATFORM_PUBLIC_KEY: config.PLATFORM_PUBLIC_KEY,
    CF_ACCOUNT_ID: config.CF_ACCOUNT_ID,
    CF_API_TOKEN: config.CF_API_TOKEN,
    CF_ZONE_ID: config.CF_ZONE_ID,
    TAKOS_CUSTOM_DOMAIN_TLS_PROVIDER: config.TAKOS_CUSTOM_DOMAIN_TLS_PROVIDER,
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
    GOOGLE_CLOUD_PROJECT: optionalEnv("GOOGLE_CLOUD_PROJECT"),
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
    TAKOS_DEFAULT_APP_INSTALL_URL: config.TAKOS_DEFAULT_APP_INSTALL_URL,
    TAKOS_DEFAULT_APP_INSTALL_TOKEN: config.TAKOS_DEFAULT_APP_INSTALL_TOKEN,
    TAKOS_DEFAULT_APP_INSTALL_ACCOUNT_ID:
      config.TAKOS_DEFAULT_APP_INSTALL_ACCOUNT_ID,
    TAKOS_DEFAULT_APP_INSTALL_SUBJECT: config.TAKOS_DEFAULT_APP_INSTALL_SUBJECT,
    TAKOS_DEFAULT_APP_INSTALL_MODE: config.TAKOS_DEFAULT_APP_INSTALL_MODE,
    TAKOS_DEFAULT_APP_INSTALL_RUNTIME_BASE_URL:
      config.TAKOS_DEFAULT_APP_INSTALL_RUNTIME_BASE_URL,
    TAKOS_APP_INSTALLATIONS_URL: config.TAKOS_APP_INSTALLATIONS_URL,
    TAKOS_APP_INSTALL_TOKEN: config.TAKOS_APP_INSTALL_TOKEN,
    TAKOS_APP_INSTALL_ACCOUNT_ID: config.TAKOS_APP_INSTALL_ACCOUNT_ID,
    TAKOS_APP_INSTALL_SUBJECT: config.TAKOS_APP_INSTALL_SUBJECT,
    TAKOS_APP_INSTALL_MODE: config.TAKOS_APP_INSTALL_MODE,
    TAKOS_APP_INSTALL_RUNTIME_BASE_URL:
      config.TAKOS_APP_INSTALL_RUNTIME_BASE_URL,
    TAKOS_DEFAULT_OFFICE_APP_REPOSITORY_URL:
      config.TAKOS_DEFAULT_OFFICE_APP_REPOSITORY_URL,
    TAKOS_DEFAULT_COMPUTER_APP_REPOSITORY_URL:
      config.TAKOS_DEFAULT_COMPUTER_APP_REPOSITORY_URL,
    TAKOS_DEFAULT_YURUCOMMU_APP_REPOSITORY_URL:
      config.TAKOS_DEFAULT_YURUCOMMU_APP_REPOSITORY_URL,
    TAKOS_DEFAULT_ROAD_TO_ME_APP_REPOSITORY_URL:
      config.TAKOS_DEFAULT_ROAD_TO_ME_APP_REPOSITORY_URL,
    TAKOS_INTERNAL_API_SECRET: config.TAKOS_INTERNAL_API_SECRET,
    AI: shared.aiBinding,
    VECTORIZE: shared.vectorizeBinding,
    OPENAI_API_KEY: optionalEnv("OPENAI_API_KEY"),
    ANTHROPIC_API_KEY: optionalEnv("ANTHROPIC_API_KEY"),
    GOOGLE_API_KEY: optionalEnv("GOOGLE_API_KEY"),
    SERPER_API_KEY: optionalEnv("SERPER_API_KEY"),
    TURNSTILE_SECRET_KEY: optionalEnv("TURNSTILE_SECRET_KEY"),
    AUDIT_IP_HASH_KEY: optionalEnv("AUDIT_IP_HASH_KEY"),
    // SSE notifier is a Node-only service, not part of the provider Env type.
    // Passed via env as an opaque property; accessed by the node platform adapter.
    ...(shared.sseNotifier ? { SSE_NOTIFIER: shared.sseNotifier } : {}),
  } as Env;
}

// ---------------------------------------------------------------------------
// Public: createNodeDispatchEnv
// ---------------------------------------------------------------------------

export async function createNodeDispatchEnv(): Promise<NodeDispatchEnv> {
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
    ROUTING_STORE: shared.routingStore,
    ADMIN_DOMAIN: config.ADMIN_DOMAIN,
    DISPATCHER: dispatcher,
  };
}
