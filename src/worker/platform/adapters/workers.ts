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
import type { PlatformEnvIndex } from "./shared.ts";
import type {
  ControlPlatform,
  PlatformServiceBinding,
} from "../platform-config.ts";
import { resolveHostnameRouting } from "../../application/services/routing/service.ts";

function serviceBindingFromEnv(
  env: PlatformEnvIndex,
  key: string,
): PlatformServiceBinding | undefined {
  const binding = env[key];
  if (
    binding &&
    typeof binding === "object" &&
    "fetch" in binding &&
    typeof (binding as { fetch?: unknown }).fetch === "function"
  ) {
    return binding as PlatformServiceBinding;
  }
  return undefined;
}

function defaultContainerHostBaseUrl(env: PlatformEnvIndex): string {
  const publicBaseUrl = getString(env, "AUTH_PUBLIC_BASE_URL");
  if (publicBaseUrl) return publicBaseUrl;
  const adminDomain = getString(env, "ADMIN_DOMAIN");
  return adminDomain ? `https://${adminDomain}` : "https://takos";
}

function createInProcessRuntimeHostBinding(
  env: PlatformEnvIndex,
): PlatformServiceBinding | undefined {
  if (!env.RUNTIME_CONTAINER) return undefined;
  const takosWorker = serviceBindingFromEnv(env, "TAKOS_EGRESS");
  return {
    async fetch(input: RequestInfo | URL, init?: RequestInit) {
      const { default: runtimeHost } = await import(
        "../../runtime/container-hosts/runtime-host.ts"
      );
      return runtimeHost.fetch(new Request(input, init), {
        ...env,
        TAKOS_WORKER: takosWorker,
        PROXY_BASE_URL: getString(env, "PROXY_BASE_URL") ??
          defaultContainerHostBaseUrl(env),
      } as never);
    },
  };
}

function createInProcessExecutorHostBinding(
  env: PlatformEnvIndex,
): PlatformServiceBinding | undefined {
  if (!env.EXECUTOR_CONTAINER) return undefined;
  const takosWorker = serviceBindingFromEnv(env, "TAKOS_EGRESS");
  return {
    async fetch(input: RequestInfo | URL, init?: RequestInit) {
      const { default: executorHost } = await import(
        "../../runtime/container-hosts/executor-host.ts"
      );
      return executorHost.fetch(new Request(input, init), {
        ...env,
        TAKOS_WORKER: takosWorker,
        TAKOS_AGENT_CONTROL_RPC_BASE_URL:
          getString(env, "TAKOS_AGENT_CONTROL_RPC_BASE_URL") ??
            defaultContainerHostBaseUrl(env),
      } as never);
    },
  };
}

function buildWorkersPlatform<TBindings extends object>(
  env: TBindings & PlatformEnvIndex,
): ControlPlatform<TBindings> {
  const runtimeHost = serviceBindingFromEnv(env, "RUNTIME_HOST") ??
    createInProcessRuntimeHostBinding(env);
  const executorHost = serviceBindingFromEnv(env, "EXECUTOR_HOST") ??
    createInProcessExecutorHostBinding(env);
  const bindings = {
    ...env,
    ...(runtimeHost ? { RUNTIME_HOST: runtimeHost } : {}),
    ...(executorHost ? { EXECUTOR_HOST: executorHost } : {}),
  } as TBindings & PlatformEnvIndex;

  const config = createPlatformConfig({
    adminDomain: getString(bindings, "ADMIN_DOMAIN"),
    tenantBaseDomain: getString(bindings, "TENANT_BASE_DOMAIN"),
    environment: getString(bindings, "ENVIRONMENT"),
    oidcIssuerUrl: getString(bindings, "OIDC_ISSUER_URL"),
    oidcDiscoveryUrl: getString(bindings, "OIDC_DISCOVERY_URL"),
    oidcClientId: getString(bindings, "OIDC_CLIENT_ID"),
    oidcClientSecret: getString(bindings, "OIDC_CLIENT_SECRET"),
    oidcRedirectUri: getString(bindings, "OIDC_REDIRECT_URI"),
    platformPrivateKey: getString(bindings, "PLATFORM_PRIVATE_KEY"),
    platformPublicKey: getString(bindings, "PLATFORM_PUBLIC_KEY"),
    encryptionKey: getString(bindings, "ENCRYPTION_KEY"),
    serviceInternalJwtIssuer: getString(bindings, "SERVICE_INTERNAL_JWT_ISSUER"),
  });

  const services = createPlatformServices({
    routing: createRoutingService({
      resolveHostname(hostname, executionContext) {
        return resolveHostnameRouting({
          env: bindings,
          hostname,
          executionCtx: executionContext,
        });
      },
    }),
    sqlBinding: bindings.DB as Env["DB"] | undefined,
    routingStore: bindings.ROUTING_STORE as Env["ROUTING_STORE"] | undefined,
    hostnameRouting: bindings.HOSTNAME_ROUTING as
      | Env["HOSTNAME_ROUTING"]
      | undefined,
    queues: {
      runs: bindings.RUN_QUEUE as Env["RUN_QUEUE"] | undefined,
      index: bindings.INDEX_QUEUE as Env["INDEX_QUEUE"] | undefined,
      workflow: bindings.WORKFLOW_QUEUE as Env["WORKFLOW_QUEUE"] | undefined,
      deployment: bindings.DEPLOY_QUEUE as Env["DEPLOY_QUEUE"] | undefined,
    },
    objects: {
      gitObjects: bindings.GIT_OBJECTS as Env["GIT_OBJECTS"] | undefined,
      offload: bindings.TAKOS_OFFLOAD as Env["TAKOS_OFFLOAD"] | undefined,
      tenantSource: bindings.TENANT_SOURCE as Env["TENANT_SOURCE"] | undefined,
      workerBundles: bindings.WORKER_BUNDLES as
        | Env["WORKER_BUNDLES"]
        | undefined,
      tenantBuilds: bindings.TENANT_BUILDS as
        | Env["TENANT_BUILDS"]
        | undefined,
    },
    notifications: {
      runNotifier: bindings.RUN_NOTIFIER as Env["RUN_NOTIFIER"] | undefined,
      sessionStore: bindings.SESSION_DO as Env["SESSION_DO"] | undefined,
      notificationNotifier: bindings.NOTIFICATION_NOTIFIER as
        | Env["NOTIFICATION_NOTIFIER"]
        | undefined,
    },
    locks: {
      rateLimiter: bindings.RATE_LIMITER_DO as
        | Env["RATE_LIMITER_DO"]
        | undefined,
    },
    hosts: {
      runtimeHost,
      executorHost,
    },
    ai: {
      binding: bindings.AI as Env["AI"] | undefined,
      vectorize: bindings.VECTORIZE as Env["VECTORIZE"] | undefined,
      openAiApiKey: getString(bindings, "OPENAI_API_KEY"),
      anthropicApiKey: getString(bindings, "ANTHROPIC_API_KEY"),
      googleApiKey: getString(bindings, "GOOGLE_API_KEY"),
    },
    assets: {
      binding: bindings.ASSETS as PlatformServiceBinding | undefined,
    },
    documents: {},
    serviceRegistry: getServiceRegistry(bindings),
  });

  return buildPlatform("workers", bindings, config, services);
}

export function buildWorkersWebPlatform(env: Env): ControlPlatform<Env> {
  return buildWorkersPlatform(env as Env & PlatformEnvIndex);
}

export function buildWorkersDispatchPlatform(
  env: DispatchEnv,
): ControlPlatform<DispatchEnv> {
  return buildWorkersPlatform(env as DispatchEnv & PlatformEnvIndex);
}

export function buildWorkersWorkerPlatform(
  env: WorkerEnv,
): ControlPlatform<WorkerEnv> {
  return buildWorkersPlatform(env as WorkerEnv & PlatformEnvIndex);
}
