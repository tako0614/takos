import type { Env } from '../../shared/types/index.ts';
import type { WorkerEnv } from '../../runtime/worker/env.ts';
import type { DispatchEnv } from '../../dispatch.ts';
import {
  buildPlatform,
  createDeploymentProviderRegistry,
  createPlatformConfig,
  createPlatformServices,
  createRoutingService,
} from './shared.ts';
import type { ControlPlatform, PlatformServiceBinding } from '../types.ts';
import { resolveHostnameRouting } from '../../application/services/routing/index.ts';

type PlatformEnvRecord = Record<string, unknown>;

function getString(env: PlatformEnvRecord, key: string): string | undefined {
  const value = env[key];
  return typeof value === 'string' ? value : undefined;
}

function getServiceRegistry(env: PlatformEnvRecord) {
  const dispatcher = env.DISPATCHER;
  if (!dispatcher || typeof dispatcher !== 'object') {
    return undefined;
  }
  return {
    get(name: string, options?: { deploymentId?: string }) {
      return (dispatcher as {
        get(name: string, options?: { deploymentId?: string }): PlatformServiceBinding;
      }).get(name, options);
    },
  };
}

function createCloudRunDeploymentRegistry(env: Record<string, unknown>) {
  const serviceId = typeof env.GCP_CLOUD_RUN_SERVICE_ID === 'string' ? env.GCP_CLOUD_RUN_SERVICE_ID : undefined;
  const artifactRegistryRepo = typeof env.GCP_ARTIFACT_REGISTRY_REPO === 'string' ? env.GCP_ARTIFACT_REGISTRY_REPO : undefined;
  const projectId = typeof env.GCP_PROJECT_ID === 'string' ? env.GCP_PROJECT_ID : undefined;
  const region = typeof env.GCP_REGION === 'string' ? env.GCP_REGION : undefined;

  if (!projectId || projectId.length === 0) {
    return undefined;
  }

  return createDeploymentProviderRegistry([
    {
      name: 'cloud-run',
      config: {
        projectId,
        region: region ?? 'us-central1',
        serviceId,
        artifactRegistryRepo,
      },
    },
  ], 'cloud-run');
}

function buildGcpPlatform<TBindings extends object>(env: TBindings & PlatformEnvRecord): ControlPlatform<TBindings> {
  const config = createPlatformConfig({
    adminDomain: getString(env, 'ADMIN_DOMAIN'),
    tenantBaseDomain: getString(env, 'TENANT_BASE_DOMAIN'),
    environment: getString(env, 'ENVIRONMENT'),
    googleClientId: getString(env, 'GOOGLE_CLIENT_ID'),
    googleClientSecret: getString(env, 'GOOGLE_CLIENT_SECRET'),
    platformPrivateKey: getString(env, 'PLATFORM_PRIVATE_KEY'),
    platformPublicKey: getString(env, 'PLATFORM_PUBLIC_KEY'),
    encryptionKey: getString(env, 'ENCRYPTION_KEY'),
    serviceInternalJwtIssuer: getString(env, 'SERVICE_INTERNAL_JWT_ISSUER'),
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
    sqlBinding: env.DB as Env['DB'] | undefined,
    routingStore: env.ROUTING_STORE as Env['ROUTING_STORE'] | undefined,
    hostnameRouting: env.HOSTNAME_ROUTING as Env['HOSTNAME_ROUTING'] | undefined,
    queues: {
      runs: env.RUN_QUEUE as Env['RUN_QUEUE'] | undefined,
      index: env.INDEX_QUEUE as Env['INDEX_QUEUE'] | undefined,
      workflow: env.WORKFLOW_QUEUE as Env['WORKFLOW_QUEUE'] | undefined,
      deployment: env.DEPLOY_QUEUE as Env['DEPLOY_QUEUE'] | undefined,
    },
    objects: {
      gitObjects: env.GIT_OBJECTS as Env['GIT_OBJECTS'] | undefined,
      offload: env.TAKOS_OFFLOAD as Env['TAKOS_OFFLOAD'] | undefined,
      tenantSource: env.TENANT_SOURCE as Env['TENANT_SOURCE'] | undefined,
      workerBundles: env.WORKER_BUNDLES as Env['WORKER_BUNDLES'] | undefined,
      tenantBuilds: env.TENANT_BUILDS as Env['TENANT_BUILDS'] | undefined,
      uiBundles: env.UI_BUNDLES as Env['UI_BUNDLES'] | undefined,
    },
    notifications: {
      runNotifier: env.RUN_NOTIFIER as Env['RUN_NOTIFIER'] | undefined,
      sessionStore: env.SESSION_DO as Env['SESSION_DO'] | undefined,
      notificationNotifier: env.NOTIFICATION_NOTIFIER as Env['NOTIFICATION_NOTIFIER'] | undefined,
    },
    locks: {
      gitPushLock: env.GIT_PUSH_LOCK as Env['GIT_PUSH_LOCK'] | undefined,
      rateLimiter: env.RATE_LIMITER_DO as Env['RATE_LIMITER_DO'] | undefined,
    },
    hosts: {
      runtimeHost: env.RUNTIME_HOST as PlatformServiceBinding | undefined,
      executorHost: env.EXECUTOR_HOST as PlatformServiceBinding | undefined,
      browserHost: env.BROWSER_HOST as PlatformServiceBinding | undefined,
    },
    ai: {
      binding: env.AI as Env['AI'] | undefined,
      vectorize: env.VECTORIZE as Env['VECTORIZE'] | undefined,
      openAiApiKey: getString(env, 'OPENAI_API_KEY'),
      anthropicApiKey: getString(env, 'ANTHROPIC_API_KEY'),
      googleApiKey: getString(env, 'GOOGLE_API_KEY'),
    },
    assets: {
      binding: env.ASSETS as PlatformServiceBinding | undefined,
    },
    serviceRegistry: getServiceRegistry(env),
    deploymentProviders: createCloudRunDeploymentRegistry(env),
  });

  return buildPlatform('gcp', env, config, services);
}

export function buildGcpWebPlatform(env: Env): ControlPlatform<Env> {
  return buildGcpPlatform(env as Env & PlatformEnvRecord);
}

export function buildGcpDispatchPlatform(env: DispatchEnv): ControlPlatform<DispatchEnv> {
  return buildGcpPlatform(env as DispatchEnv & PlatformEnvRecord);
}

export function buildGcpWorkerPlatform(env: WorkerEnv): ControlPlatform<WorkerEnv> {
  return buildGcpPlatform(env as WorkerEnv & PlatformEnvRecord);
}
