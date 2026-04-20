import type { Env } from "../../shared/types/index.ts";
import type { WorkerEnv } from "../../runtime/worker/env.ts";
import type { DispatchEnv } from "../../dispatch.ts";
import {
  buildPlatform,
  createPlatformConfig,
  createPlatformServices,
  createRoutingService,
  getServiceRegistry,
  getString,
} from "./shared.ts";
import type { PlatformEnvRecord } from "./shared.ts";
import type {
  ControlPlatform,
  PlatformServiceBinding,
  PlatformServices,
  PlatformSource,
} from "../platform-config.ts";
import {
  createDeploymentBackendRegistry,
  resolveDeploymentBackendConfigsFromEnv,
} from "../deployment-backends.ts";
import { resolveHostnameRouting } from "../../application/services/routing/service.ts";

function resolveSourceLabel(env: PlatformEnvRecord): PlatformSource {
  const explicit = getString(env, "TAKOS_PLATFORM_SOURCE");
  if (explicit === "workers" || explicit === "node") {
    return explicit;
  }
  return "node";
}

// ---------------------------------------------------------------------------
// Unified Node.js platform builder
// ---------------------------------------------------------------------------

async function buildNodePlatformFromEnv<TBindings extends object>(
  env: TBindings & PlatformEnvRecord,
): Promise<ControlPlatform<TBindings>> {
  const source = resolveSourceLabel(env);

  const config = createPlatformConfig({
    adminDomain: getString(env, "ADMIN_DOMAIN"),
    tenantBaseDomain: getString(env, "TENANT_BASE_DOMAIN"),
    environment: getString(env, "ENVIRONMENT"),
    googleClientId: getString(env, "GOOGLE_CLIENT_ID"),
    googleClientSecret: getString(env, "GOOGLE_CLIENT_SECRET"),
    platformPrivateKey: getString(env, "PLATFORM_PRIVATE_KEY"),
    platformPublicKey: getString(env, "PLATFORM_PUBLIC_KEY"),
    encryptionKey: getString(env, "ENCRYPTION_KEY"),
    serviceInternalJwtIssuer: getString(env, "SERVICE_INTERNAL_JWT_ISSUER"),
  });

  const services = createPlatformServices({
    routing: createRoutingService({
      resolveHostname(hostname, executionContext) {
        return resolveHostnameRouting({
          env,
          hostname,
          executionCtx: executionContext,
        });
      },
    }),
    sqlBinding: env.DB as Env["DB"] | undefined,
    routingStore: env.ROUTING_STORE as Env["ROUTING_STORE"] | undefined,
    hostnameRouting: env.HOSTNAME_ROUTING as
      | Env["HOSTNAME_ROUTING"]
      | undefined,
    queues: {
      runs: env.RUN_QUEUE as Env["RUN_QUEUE"] | undefined,
      index: env.INDEX_QUEUE as Env["INDEX_QUEUE"] | undefined,
      workflow: env.WORKFLOW_QUEUE as Env["WORKFLOW_QUEUE"] | undefined,
      deployment: env.DEPLOY_QUEUE as Env["DEPLOY_QUEUE"] | undefined,
    },
    objects: {
      gitObjects: env.GIT_OBJECTS as Env["GIT_OBJECTS"] | undefined,
      offload: env.TAKOS_OFFLOAD as Env["TAKOS_OFFLOAD"] | undefined,
      tenantSource: env.TENANT_SOURCE as Env["TENANT_SOURCE"] | undefined,
      workerBundles: env.WORKER_BUNDLES as Env["WORKER_BUNDLES"] | undefined,
      tenantBuilds: env.TENANT_BUILDS as Env["TENANT_BUILDS"] | undefined,
    },
    notifications: {
      runNotifier: env.RUN_NOTIFIER as Env["RUN_NOTIFIER"] | undefined,
      sessionStore: env.SESSION_DO as Env["SESSION_DO"] | undefined,
      notificationNotifier: env.NOTIFICATION_NOTIFIER as
        | Env["NOTIFICATION_NOTIFIER"]
        | undefined,
    },
    locks: {
      gitPushLock: env.GIT_PUSH_LOCK as Env["GIT_PUSH_LOCK"] | undefined,
      rateLimiter: env.RATE_LIMITER_DO as Env["RATE_LIMITER_DO"] | undefined,
    },
    hosts: {
      runtimeHost: env.RUNTIME_HOST as PlatformServiceBinding | undefined,
      executorHost: env.EXECUTOR_HOST as PlatformServiceBinding | undefined,
    },
    ai: {
      binding: env.AI as Env["AI"] | undefined,
      vectorize: env.VECTORIZE as Env["VECTORIZE"] | undefined,
      openAiApiKey: getString(env, "OPENAI_API_KEY"),
      anthropicApiKey: getString(env, "ANTHROPIC_API_KEY"),
      googleApiKey: getString(env, "GOOGLE_API_KEY"),
    },
    assets: {
      binding: env.ASSETS as PlatformServiceBinding | undefined,
    },
    documents: {},
    serviceRegistry: getServiceRegistry(env),
    sseNotifier: (env as Record<string, unknown>)
      .SSE_NOTIFIER as PlatformServices["sseNotifier"],
    deploymentBackends: createDeploymentBackendRegistry(
      resolveDeploymentBackendConfigsFromEnv(env),
    ),
  });

  return buildPlatform(source, env, config, services);
}

// ---------------------------------------------------------------------------
// Public API — matches the shape of the per-platform adapters
// ---------------------------------------------------------------------------

export function buildNodeWebPlatform(env: Env): Promise<ControlPlatform<Env>> {
  return buildNodePlatformFromEnv(env as Env & PlatformEnvRecord);
}

export function buildNodeDispatchPlatform(
  env: DispatchEnv,
): Promise<ControlPlatform<DispatchEnv>> {
  return buildNodePlatformFromEnv(env as DispatchEnv & PlatformEnvRecord);
}

export function buildNodeWorkerPlatform(
  env: WorkerEnv,
): Promise<ControlPlatform<WorkerEnv>> {
  return buildNodePlatformFromEnv(env as WorkerEnv & PlatformEnvRecord);
}
