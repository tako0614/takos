import type { Env } from '../../shared/types/index.ts';
import type { WorkerEnv } from '../../runtime/worker/env.ts';
import type { DispatchEnv } from '../../dispatch.ts';
import {
  buildPlatform,
  createDeploymentProviderRegistry,
  createPlatformConfig,
  createPlatformServices,
  createRoutingService,
  getString,
  getServiceRegistry,
} from './shared.ts';
import type { PlatformEnvRecord } from './shared.ts';
import type {
  ControlPlatform,
  PlatformDeployProviderConfig,
  PlatformServiceBinding,
  PlatformServices,
  PlatformSource,
} from '../types.ts';
import { resolveHostnameRouting } from '../../application/services/routing/service.ts';

// ---------------------------------------------------------------------------
// PDF rendering (optional — requires puppeteer-core or puppeteer + Chrome)
// ---------------------------------------------------------------------------

async function buildNodeDocuments(env: PlatformEnvRecord): Promise<PlatformServices['documents']> {
  const cdpUrl = getString(env, 'CHROME_CDP_URL');
  const executablePath = getString(env, 'PUPPETEER_EXECUTABLE_PATH');

  if (!cdpUrl && !executablePath) {
    return {};
  }

  try {
    const { createNodePdfRenderer } = await import(
      '../providers/node/pdf-render.ts'
    );
    const renderPdf = createNodePdfRenderer({ cdpUrl, executablePath });
    return { renderPdf };
  } catch {
    // puppeteer-core / puppeteer is not installed — degrade gracefully.
    return {};
  }
}

// ---------------------------------------------------------------------------
// Deployment provider auto-detection: detect ALL available providers
// ---------------------------------------------------------------------------

function detectDeploymentProviders(env: PlatformEnvRecord) {
  const providers: PlatformDeployProviderConfig[] = [];

  // Cloudflare Workers for Platforms
  const cfAccountId = getString(env, 'CF_ACCOUNT_ID');
  const cfApiToken = getString(env, 'CF_API_TOKEN');
  const cfDispatchNamespace = getString(env, 'WFP_DISPATCH_NAMESPACE');
  if (cfAccountId && cfApiToken && cfDispatchNamespace) {
    providers.push({
      name: 'workers-dispatch',
      config: {
        accountId: cfAccountId,
        apiToken: cfApiToken,
        dispatchNamespace: cfDispatchNamespace,
        zoneId: getString(env, 'CF_ZONE_ID'),
      },
    });
  }

  // AWS ECS
  const ecsClusterArn = getString(env, 'AWS_ECS_CLUSTER_ARN');
  if (ecsClusterArn) {
    providers.push({
      name: 'ecs',
      config: {
        region: getString(env, 'AWS_REGION') ?? 'us-east-1',
        clusterArn: ecsClusterArn,
        taskDefinitionFamily: getString(env, 'AWS_ECS_TASK_FAMILY') ?? '',
        serviceArn: getString(env, 'AWS_ECS_SERVICE_ARN'),
        ecrRepositoryUri: getString(env, 'AWS_ECR_REPO_URI'),
      },
    });
  }

  // GCP Cloud Run
  const gcpProjectId = getString(env, 'GCP_PROJECT_ID');
  if (gcpProjectId) {
    providers.push({
      name: 'cloud-run',
      config: {
        projectId: gcpProjectId,
        region: getString(env, 'GCP_REGION') ?? 'us-central1',
        serviceId: getString(env, 'GCP_CLOUD_RUN_SERVICE_ID'),
        artifactRegistryRepo: getString(env, 'GCP_ARTIFACT_REGISTRY_REPO'),
      },
    });
  }

  // OCI Orchestrator (local / generic container)
  const ociUrl = getString(env, 'OCI_ORCHESTRATOR_URL');
  if (ociUrl) {
    providers.push({
      name: 'oci',
      config: {
        orchestratorUrl: ociUrl,
        orchestratorToken: getString(env, 'OCI_ORCHESTRATOR_TOKEN'),
      },
    });
  }

  return providers;
}

function resolveDefaultProviderName(
  env: PlatformEnvRecord,
  providers: PlatformDeployProviderConfig[],
): PlatformDeployProviderConfig['name'] | undefined {
  const explicit = getString(env, 'TAKOS_DEFAULT_DEPLOY_PROVIDER');
  if (explicit) {
    const found = providers.find((p) => p.name === explicit);
    if (found) return found.name;
  }
  return providers[0]?.name;
}

// ---------------------------------------------------------------------------
// Source label
// ---------------------------------------------------------------------------

function resolveSourceLabel(env: PlatformEnvRecord): PlatformSource {
  const explicit = getString(env, 'TAKOS_PLATFORM_SOURCE');
  if (explicit === 'workers' || explicit === 'node') {
    return explicit;
  }
  return 'node';
}

// ---------------------------------------------------------------------------
// Unified Node.js platform builder
// ---------------------------------------------------------------------------

async function buildNodePlatformFromEnv<TBindings extends object>(env: TBindings & PlatformEnvRecord): Promise<ControlPlatform<TBindings>> {
  const source = resolveSourceLabel(env);

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

  const providers = detectDeploymentProviders(env);
  const defaultName = resolveDefaultProviderName(env, providers);

  const documents = await buildNodeDocuments(env);

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
    documents,
    serviceRegistry: getServiceRegistry(env),
    deploymentProviders: createDeploymentProviderRegistry(providers, defaultName),
    sseNotifier: (env as Record<string, unknown>).SSE_NOTIFIER as PlatformServices['sseNotifier'],
  });

  return buildPlatform(source, env, config, services);
}

// ---------------------------------------------------------------------------
// Public API — matches the shape of the per-platform adapters
// ---------------------------------------------------------------------------

export function buildNodeWebPlatform(env: Env): Promise<ControlPlatform<Env>> {
  return buildNodePlatformFromEnv(env as Env & PlatformEnvRecord);
}

export function buildNodeDispatchPlatform(env: DispatchEnv): Promise<ControlPlatform<DispatchEnv>> {
  return buildNodePlatformFromEnv(env as DispatchEnv & PlatformEnvRecord);
}

export function buildNodeWorkerPlatform(env: WorkerEnv): Promise<ControlPlatform<WorkerEnv>> {
  return buildNodePlatformFromEnv(env as WorkerEnv & PlatformEnvRecord);
}
