import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Env } from '../../shared/types/index.ts';
import type { ServiceBindingFetcher } from '../../shared/types/bindings.ts';
import type { DispatchEnv } from '../../dispatch.ts';
import {
  createInMemoryD1Database,
  createInMemoryDurableObjectNamespace,
  createInMemoryKVNamespace,
  createInMemoryQueue,
  createInMemoryR2Bucket,
} from '../in-memory-bindings.ts';
import {
  createPersistentDurableObjectNamespace,
  createPersistentKVNamespace,
  createPersistentQueue,
  createPersistentR2Bucket,
  createPostgresD1Database,
  createSqliteD1Database,
  removeLocalDataDir,
} from '../persistent-bindings.ts';
import { LOCAL_QUEUE_NAMES } from '../queue-runtime.ts';
import { createInMemoryRoutingStore, createPersistentRoutingStore } from '../routing-store.ts';
import { createRedisQueue, createRedisRoutingStore, disposeRedisClient } from '../redis-bindings.ts';
import { createFetcherRegistry, parseServiceTargetMap } from '../url-registry.ts';
import {
  createLocalTenantWorkerRuntimeRegistry,
  type TenantWorkerRuntimeRegistry,
} from '../tenant-worker-runtime.ts';
type RoutingRecordInput =
  | {
      type?: 'deployments' | 'http-endpoint-set';
      deployments?: Array<{ routeRef: string; weight?: number; status?: 'active' | 'canary' | 'rollback' }>;
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

type SharedState = Awaited<ReturnType<typeof createSharedState>>;

function resolveLocalDataDir(): string | null {
  const explicit = process.env.TAKOS_LOCAL_DATA_DIR?.trim();
  if (explicit) return path.resolve(explicit);
  if (process.env.VITEST) return null;
  return path.resolve(process.cwd(), '.takos-local');
}

function resolveLocalPostgresUrl(): string | null {
  const raw = process.env.POSTGRES_URL?.trim() || process.env.DATABASE_URL?.trim() || '';
  if (!raw) return null;
  if (!/^postgres(ql)?:\/\//i.test(raw)) return null;
  return raw;
}

function resolveRedisUrl(): string | null {
  const explicit = process.env.REDIS_URL?.trim();
  return explicit ? explicit : null;
}

async function createSharedState() {
  const dataDir = resolveLocalDataDir();
  const postgresUrl = resolveLocalPostgresUrl();
  const redisUrl = resolveRedisUrl();
  const packageDir = path.dirname(fileURLToPath(import.meta.url));
  // Keep local SQLite bootstraps on the package-owned migration set even when
  // tests execute package sources through the apps/control Vitest root.
  const migrationsDir = path.resolve(packageDir, '../../../../../packages/control/db/migrations');
  const createRoutingStore = () => {
    if (redisUrl) return createRedisRoutingStore(redisUrl);
    if (!dataDir) return createInMemoryRoutingStore();
    return null;
  };

  const createQueue = (queueName: string) => {
    if (redisUrl) return createRedisQueue(redisUrl, queueName);
    if (!dataDir) return createInMemoryQueue(queueName);
    return null;
  };
  const routingStore = createRoutingStore();
  const db = postgresUrl
    ? await createPostgresD1Database(postgresUrl)
    : dataDir
      ? await createSqliteD1Database(path.join(dataDir, 'db', 'control.sqlite'), migrationsDir)
      : createInMemoryD1Database();

  if (!dataDir) {
    return {
      dataDir: null,
      db,
      hostnameRouting: createInMemoryKVNamespace(),
      routingDo: createInMemoryDurableObjectNamespace(),
      routingStore: routingStore ?? createInMemoryRoutingStore(),
      sessionDo: createInMemoryDurableObjectNamespace(),
      runNotifier: createInMemoryDurableObjectNamespace(),
      gitPushLock: createInMemoryDurableObjectNamespace(),
      runQueue: createQueue(LOCAL_QUEUE_NAMES.run) ?? createInMemoryQueue(LOCAL_QUEUE_NAMES.run),
      indexQueue: createQueue(LOCAL_QUEUE_NAMES.index) ?? createInMemoryQueue(LOCAL_QUEUE_NAMES.index),
      workflowQueue: createQueue(LOCAL_QUEUE_NAMES.workflow) ?? createInMemoryQueue(LOCAL_QUEUE_NAMES.workflow),
      deployQueue: createQueue(LOCAL_QUEUE_NAMES.deployment) ?? createInMemoryQueue(LOCAL_QUEUE_NAMES.deployment),
      gitObjects: createInMemoryR2Bucket(),
      offload: createInMemoryR2Bucket(),
      tenantSource: createInMemoryR2Bucket(),
      workerBundles: createInMemoryR2Bucket(),
      tenantBuilds: createInMemoryR2Bucket(),
      uiBundles: createInMemoryR2Bucket(),
    };
  }

  return {
    dataDir,
    db,
    hostnameRouting: createPersistentKVNamespace(path.join(dataDir, 'kv', 'hostname-routing.json')),
    routingDo: createPersistentDurableObjectNamespace(path.join(dataDir, 'durable-objects', 'routing.json')),
    routingStore: routingStore ?? createPersistentRoutingStore(path.join(dataDir, 'routing', 'routing-store.json')),
    sessionDo: createPersistentDurableObjectNamespace(path.join(dataDir, 'durable-objects', 'session.json')),
    runNotifier: createPersistentDurableObjectNamespace(path.join(dataDir, 'durable-objects', 'run-notifier.json')),
    gitPushLock: createPersistentDurableObjectNamespace(path.join(dataDir, 'durable-objects', 'git-push-lock.json')),
    runQueue: createQueue(LOCAL_QUEUE_NAMES.run) ?? createPersistentQueue(path.join(dataDir, 'queues', 'run-queue.json'), LOCAL_QUEUE_NAMES.run),
    indexQueue: createQueue(LOCAL_QUEUE_NAMES.index) ?? createPersistentQueue(path.join(dataDir, 'queues', 'index-queue.json'), LOCAL_QUEUE_NAMES.index),
    workflowQueue: createQueue(LOCAL_QUEUE_NAMES.workflow) ?? createPersistentQueue(path.join(dataDir, 'queues', 'workflow-queue.json'), LOCAL_QUEUE_NAMES.workflow),
    deployQueue: createQueue(LOCAL_QUEUE_NAMES.deployment) ?? createPersistentQueue(path.join(dataDir, 'queues', 'deploy-queue.json'), LOCAL_QUEUE_NAMES.deployment),
    gitObjects: createPersistentR2Bucket(path.join(dataDir, 'buckets', 'git-objects.json')),
    offload: createPersistentR2Bucket(path.join(dataDir, 'buckets', 'takos-offload.json')),
    tenantSource: createPersistentR2Bucket(path.join(dataDir, 'buckets', 'tenant-source.json')),
    workerBundles: createPersistentR2Bucket(path.join(dataDir, 'buckets', 'worker-bundles.json')),
    tenantBuilds: createPersistentR2Bucket(path.join(dataDir, 'buckets', 'tenant-builds.json')),
    uiBundles: createPersistentR2Bucket(path.join(dataDir, 'buckets', 'ui-bundles.json')),
  };
}

// Resolve local storage/runtime inputs lazily so test and child-process callers
// can override TAKOS_LOCAL_* env vars before the first platform access.
let sharedPromise: Promise<SharedState> | null = null;
const dispatchRegistries = new Set<TenantWorkerRuntimeRegistry>();

let seeded = false;

async function ensureRoutingSeeded(): Promise<void> {
  if (seeded) return;
  seeded = true;

  const shared = await getSharedState();
  const routingSeed = parseRoutingSeed(process.env.TAKOS_LOCAL_ROUTING_JSON);
  for (const [hostname, value] of Object.entries(routingSeed)) {
    await shared.hostnameRouting.put(hostname.toLowerCase(), serializeRoutingValue(value));
    const target = value.type === 'http-endpoint-set'
      ? { type: 'http-endpoint-set' as const, endpoints: value.endpoints ?? [] }
      : { type: 'deployments' as const, deployments: (value.deployments ?? []).map((deployment) => ({
        routeRef: deployment.routeRef,
        weight: deployment.weight ?? 100,
        status: deployment.status ?? 'active',
      })) };
    await shared.routingStore.putRecord(hostname, target, Date.now());
  }
}

async function getSharedState(): Promise<SharedState> {
  if (!sharedPromise) {
    sharedPromise = createSharedState().catch((error) => {
      sharedPromise = null;
      throw error;
    });
  }
  return sharedPromise;
}

export async function disposeLocalPlatformState(): Promise<void> {
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

export async function resetLocalPlatformStateForTests(): Promise<void> {
  await disposeLocalPlatformState();
}

export async function clearLocalPlatformDataForTests(): Promise<void> {
  const dataDir = resolveLocalDataDir();
  if (!dataDir) return;
  await removeLocalDataDir(dataDir);
}

function buildBaseConfig() {
  return {
    ADMIN_DOMAIN: process.env.ADMIN_DOMAIN ?? 'takos.localhost',
    TENANT_BASE_DOMAIN: process.env.TENANT_BASE_DOMAIN ?? 'tenant.localhost',
    GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID ?? 'local-google-client',
    GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET ?? 'local-google-secret',
    PLATFORM_PRIVATE_KEY: process.env.PLATFORM_PRIVATE_KEY ?? 'local-platform-private-key',
    PLATFORM_PUBLIC_KEY: process.env.PLATFORM_PUBLIC_KEY ?? 'local-platform-public-key',
    CF_ACCOUNT_ID: process.env.CF_ACCOUNT_ID?.trim() || undefined,
    CF_API_TOKEN: process.env.CF_API_TOKEN?.trim() || undefined,
    CF_ZONE_ID: process.env.CF_ZONE_ID?.trim() || undefined,
    WFP_DISPATCH_NAMESPACE: process.env.WFP_DISPATCH_NAMESPACE?.trim() || undefined,
    ENCRYPTION_KEY: process.env.ENCRYPTION_KEY ?? 'local-encryption-key',
    SERVICE_INTERNAL_JWT_ISSUER: process.env.SERVICE_INTERNAL_JWT_ISSUER ?? 'takos-local',
    ENVIRONMENT: 'development',
    ROUTING_DO_PHASE: process.env.ROUTING_DO_PHASE ?? '1',
  } as const;
}

export async function createTakosWebEnv(): Promise<Env> {
  await ensureRoutingSeeded();
  const config = buildBaseConfig();
  const shared = await getSharedState();

  return {
    DB: shared.db,
    HOSTNAME_ROUTING: shared.hostnameRouting,
    ROUTING_DO: shared.routingDo,
    ROUTING_DO_PHASE: config.ROUTING_DO_PHASE,
    ROUTING_STORE: shared.routingStore,
    SESSION_DO: shared.sessionDo,
    RUN_NOTIFIER: shared.runNotifier,
    GIT_PUSH_LOCK: shared.gitPushLock,
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
    OCI_ORCHESTRATOR_URL: process.env.OCI_ORCHESTRATOR_URL?.trim() || undefined,
    OCI_ORCHESTRATOR_TOKEN: process.env.OCI_ORCHESTRATOR_TOKEN?.trim() || undefined,
    ENCRYPTION_KEY: config.ENCRYPTION_KEY,
    SERVICE_INTERNAL_JWT_ISSUER: config.SERVICE_INTERNAL_JWT_ISSUER,
    ENVIRONMENT: config.ENVIRONMENT,
  };
}

export async function createTakosDispatchEnv(): Promise<DispatchEnv> {
  await ensureRoutingSeeded();
  const config = buildBaseConfig();
  const shared = await getSharedState();
  const targets = parseServiceTargetMap(process.env.TAKOS_LOCAL_DISPATCH_TARGETS_JSON);
  const implicitTargets = {
    ...(process.env.TAKOS_LOCAL_RUNTIME_URL?.trim()
      ? {
          RUNTIME_HOST: process.env.TAKOS_LOCAL_RUNTIME_URL.trim(),
          'runtime-host': process.env.TAKOS_LOCAL_RUNTIME_URL.trim(),
        }
      : {}),
    ...(process.env.TAKOS_LOCAL_EXECUTOR_URL?.trim()
      ? {
          EXECUTOR_HOST: process.env.TAKOS_LOCAL_EXECUTOR_URL.trim(),
          'executor-host': process.env.TAKOS_LOCAL_EXECUTOR_URL.trim(),
        }
      : {}),
    ...(process.env.TAKOS_LOCAL_BROWSER_URL?.trim()
      ? {
          BROWSER_HOST: process.env.TAKOS_LOCAL_BROWSER_URL.trim(),
          'browser-host': process.env.TAKOS_LOCAL_BROWSER_URL.trim(),
        }
      : {}),
    ...(process.env.TAKOS_LOCAL_EGRESS_URL?.trim()
      ? {
          TAKOS_EGRESS: process.env.TAKOS_LOCAL_EGRESS_URL.trim(),
          'takos-egress': process.env.TAKOS_LOCAL_EGRESS_URL.trim(),
        }
      : {}),
  };
  const serviceTargets = {
    ...implicitTargets,
    ...targets,
  };
  const tenantWorkerRuntimeRegistry = await createLocalTenantWorkerRuntimeRegistry({
    dataDir: shared.dataDir,
    db: shared.db,
    workerBundles: shared.workerBundles,
    encryptionKey: config.ENCRYPTION_KEY,
    serviceTargets,
  });
  dispatchRegistries.add(tenantWorkerRuntimeRegistry);

  return {
    HOSTNAME_ROUTING: shared.hostnameRouting,
    ROUTING_DO: shared.routingDo,
    ROUTING_DO_PHASE: config.ROUTING_DO_PHASE,
    ROUTING_STORE: shared.routingStore,
    ADMIN_DOMAIN: config.ADMIN_DOMAIN,
    DISPATCHER: createFetcherRegistry(
      serviceTargets,
      (name) => tenantWorkerRuntimeRegistry.get(name) as ServiceBindingFetcher,
    ) as unknown as DispatchEnv['DISPATCHER'],
  };
}
