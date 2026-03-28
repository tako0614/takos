import os from 'node:os';
import path from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import { and, desc, eq, inArray } from 'drizzle-orm';
import type { D1Database, Fetcher, R2Bucket } from '../shared/types/bindings.ts';
import type { WorkerBinding } from '../application/services/wfp/index.ts';
import { deployments, getDb } from '../infra/db/index.ts';
import { services } from '../infra/db/schema-services';
import { CF_COMPATIBILITY_DATE } from '../shared/constants/app.ts';
import { decrypt, decryptEnvVars, type EncryptedData } from '../shared/utils/crypto.ts';
import { createForwardingFetcher, type ServiceTargetMap } from './url-registry.ts';
import type {
  TenantWorkerFetcher,
  TenantWorkerQueueMessage,
  TenantWorkerQueueResult,
  TenantWorkerRuntimeRegistry,
  TenantWorkerScheduledOptions,
  TenantWorkerScheduledResult,
  TenantWorkflowInvocation,
} from './tenant-worker-runtime.ts';
import {
  createVectorizeServiceHandler,
  createAiServiceHandler,
  createAnalyticsServiceHandler,
  createWorkflowServiceHandler,
} from './tenant-binding-rpc.ts';
import { generateWrapperScript, type PolyfillBindingEntry } from './tenant-binding-polyfills.ts';
import { parseTenantResourceLimits } from './tenant-resource-limits.ts';

type FetcherLike = Fetcher;

type LocalTenantWorkerRegistryOptions = {
  db: D1Database;
  workerBundles?: R2Bucket;
  encryptionKey?: string;
  bundleCacheRoot?: string | null;
  persistRoot?: string | null;
  serviceTargets?: ServiceTargetMap;
  /** PostgreSQL pool for pgvector-backed Vectorize bindings. */
  pgPool?: { query(text: string, values?: unknown[]): Promise<{ rows: Record<string, unknown>[]; rowCount: number | null }> };
  /** OpenAI API key for AI bindings. */
  openAiApiKey?: string;
  /** OpenAI-compatible base URL for AI bindings. */
  openAiBaseUrl?: string;
  /** OTEL collector endpoint for Analytics Engine bindings. */
  otelEndpoint?: string;
};

type DeploymentRuntimeRecord = {
  id: string;
  serviceId: string;
  routeRef: string;
  artifactRef: string;
  bundleR2Key: string;
  wasmR2Key: string | null;
  runtimeConfigSnapshotJson: string;
  bindingsSnapshotEncrypted: string | null;
  envVarsSnapshotEncrypted: string | null;
};

function deploymentMatchesWorkerRef(deployment: DeploymentRuntimeRecord, workerRef: string): boolean {
  return deployment.routeRef === workerRef || deployment.artifactRef === workerRef;
}

type WorkerRuntimeConfigSnapshot = {
  compatibility_date?: string;
  compatibility_flags?: string[];
};

type MiniflareInstance = {
  ready: Promise<void>;
  getWorker(): Promise<unknown>;
  dispose(): Promise<void>;
};

type MiniflareModule = {
  Miniflare: new (options: unknown) => MiniflareInstance;
};

type ResolvedTenantWorker = {
  fetcher: TenantWorkerFetcher;
  runtime: MiniflareInstance;
};

type PreparedBundle = {
  bundleContent: string;
  workerDir: string;
  scriptPath: string;
};

const LOCAL_ROUTING_STATUSES = ['active', 'canary', 'rollback'] as const;

function resolveRoot(explicit: string | null | undefined, suffix: string): string {
  return explicit && explicit.trim()
    ? path.resolve(explicit)
    : path.resolve(os.tmpdir(), 'takos-miniflare', suffix);
}

function sanitizeWorkerRef(workerRef: string): string {
  return workerRef.replace(/[^a-zA-Z0-9._-]+/g, '-');
}

function parseRuntimeConfig(raw: string | null | undefined): WorkerRuntimeConfigSnapshot {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return {
      compatibility_date: typeof parsed.compatibility_date === 'string' ? parsed.compatibility_date : undefined,
      compatibility_flags: Array.isArray(parsed.compatibility_flags)
        ? parsed.compatibility_flags.filter((value): value is string => typeof value === 'string')
        : undefined,
    };
  } catch {
    return {};
  }
}

function parseDeploymentRouteRef(targetJson: string | null | undefined): string | null {
  if (!targetJson) return null;
  try {
    const parsed = JSON.parse(targetJson) as Record<string, unknown>;
    if (typeof parsed.route_ref === 'string' && parsed.route_ref.trim()) {
      return parsed.route_ref.trim();
    }
    const endpoint = parsed.endpoint;
    if (endpoint && typeof endpoint === 'object') {
      const endpointRecord = endpoint as Record<string, unknown>;
      if (endpointRecord.kind === 'service-ref' && typeof endpointRecord.ref === 'string' && endpointRecord.ref.trim()) {
        return endpointRecord.ref.trim();
      }
    }
  } catch {
    return null;
  }
  return null;
}

async function decryptBindingsSnapshot(
  deployment: DeploymentRuntimeRecord,
  encryptionKey: string | undefined,
): Promise<WorkerBinding[]> {
  if (!deployment.bindingsSnapshotEncrypted) return [];
  if (!encryptionKey) {
    throw new Error(`ENCRYPTION_KEY is required to load bindings for ${deployment.artifactRef}`);
  }

  const encryptedParsed = JSON.parse(deployment.bindingsSnapshotEncrypted) as EncryptedData;
  const decrypted = await decrypt(encryptedParsed, encryptionKey, deployment.id);
  const bindings = JSON.parse(decrypted) as unknown;
  if (!Array.isArray(bindings)) {
    throw new Error(`Invalid bindings snapshot for ${deployment.artifactRef}`);
  }
  return bindings as WorkerBinding[];
}

async function decryptEnvVarSnapshot(
  deployment: DeploymentRuntimeRecord,
  encryptionKey: string | undefined,
): Promise<Record<string, string>> {
  if (!deployment.envVarsSnapshotEncrypted) return {};
  if (!encryptionKey) {
    throw new Error(`ENCRYPTION_KEY is required to load env vars for ${deployment.artifactRef}`);
  }
  return decryptEnvVars(deployment.envVarsSnapshotEncrypted, encryptionKey, deployment.id);
}

async function resolveDeploymentRuntime(
  dbBinding: D1Database,
  workerRef: string,
  options?: { deploymentId?: string },
): Promise<DeploymentRuntimeRecord | null> {
  const db = getDb(dbBinding);
  if (options?.deploymentId) {
    const byDeploymentId = await db.select({
      id: deployments.id,
      serviceId: deployments.serviceId,
      routeRef: services.routeRef,
      artifactRef: deployments.artifactRef,
      bundleR2Key: deployments.bundleR2Key,
      wasmR2Key: deployments.wasmR2Key,
      runtimeConfigSnapshotJson: deployments.runtimeConfigSnapshotJson,
      bindingsSnapshotEncrypted: deployments.bindingsSnapshotEncrypted,
      envVarsSnapshotEncrypted: deployments.envVarsSnapshotEncrypted,
    })
      .from(deployments)
      .innerJoin(services, eq(services.id, deployments.serviceId))
      .where(and(
        eq(deployments.id, options.deploymentId),
        inArray(deployments.routingStatus, LOCAL_ROUTING_STATUSES),
      ))
      .get();

    if (byDeploymentId?.artifactRef && byDeploymentId.bundleR2Key) {
      const resolvedDeployment = {
        id: byDeploymentId.id,
        serviceId: byDeploymentId.serviceId,
        routeRef: byDeploymentId.routeRef ?? workerRef,
        artifactRef: byDeploymentId.artifactRef,
        bundleR2Key: byDeploymentId.bundleR2Key,
        wasmR2Key: byDeploymentId.wasmR2Key,
        runtimeConfigSnapshotJson: byDeploymentId.runtimeConfigSnapshotJson,
        bindingsSnapshotEncrypted: byDeploymentId.bindingsSnapshotEncrypted,
        envVarsSnapshotEncrypted: byDeploymentId.envVarsSnapshotEncrypted,
      };

      if (!deploymentMatchesWorkerRef(resolvedDeployment, workerRef)) {
        throw new Error(
          `Deployment ${options.deploymentId} does not belong to local tenant worker ${workerRef}`,
        );
      }

      return resolvedDeployment;
    }

    return null;
  }

  const byArtifact = await db.select({
    id: deployments.id,
    serviceId: deployments.serviceId,
    routeRef: services.routeRef,
    artifactRef: deployments.artifactRef,
    bundleR2Key: deployments.bundleR2Key,
    wasmR2Key: deployments.wasmR2Key,
    runtimeConfigSnapshotJson: deployments.runtimeConfigSnapshotJson,
    bindingsSnapshotEncrypted: deployments.bindingsSnapshotEncrypted,
    envVarsSnapshotEncrypted: deployments.envVarsSnapshotEncrypted,
  })
    .from(deployments)
    .innerJoin(services, eq(services.id, deployments.serviceId))
    .where(and(
      eq(deployments.artifactRef, workerRef),
      inArray(deployments.routingStatus, LOCAL_ROUTING_STATUSES),
    ))
    .orderBy(desc(deployments.version))
    .get();

  if (byArtifact?.artifactRef && byArtifact.bundleR2Key) {
    return {
      id: byArtifact.id,
      serviceId: byArtifact.serviceId,
      routeRef: byArtifact.routeRef ?? workerRef,
      artifactRef: byArtifact.artifactRef,
      bundleR2Key: byArtifact.bundleR2Key,
      wasmR2Key: byArtifact.wasmR2Key,
      runtimeConfigSnapshotJson: byArtifact.runtimeConfigSnapshotJson,
      bindingsSnapshotEncrypted: byArtifact.bindingsSnapshotEncrypted,
      envVarsSnapshotEncrypted: byArtifact.envVarsSnapshotEncrypted,
    };
  }

  const byWorker = await db.select({
    id: deployments.id,
    serviceId: deployments.serviceId,
    routeRef: services.routeRef,
    artifactRef: deployments.artifactRef,
    bundleR2Key: deployments.bundleR2Key,
    wasmR2Key: deployments.wasmR2Key,
    runtimeConfigSnapshotJson: deployments.runtimeConfigSnapshotJson,
    bindingsSnapshotEncrypted: deployments.bindingsSnapshotEncrypted,
    envVarsSnapshotEncrypted: deployments.envVarsSnapshotEncrypted,
  })
    .from(services)
    .innerJoin(deployments, eq(deployments.id, services.activeDeploymentId))
    .where(eq(services.routeRef, workerRef))
    .get();

  if (byWorker?.artifactRef && byWorker.bundleR2Key) {
    return {
      id: byWorker.id,
      serviceId: byWorker.serviceId,
      routeRef: byWorker.routeRef ?? workerRef,
      artifactRef: byWorker.artifactRef,
      bundleR2Key: byWorker.bundleR2Key,
      wasmR2Key: byWorker.wasmR2Key,
      runtimeConfigSnapshotJson: byWorker.runtimeConfigSnapshotJson,
      bindingsSnapshotEncrypted: byWorker.bindingsSnapshotEncrypted,
      envVarsSnapshotEncrypted: byWorker.envVarsSnapshotEncrypted,
    };
  }

  const candidateDeployments = await db.select({
    id: deployments.id,
    serviceId: deployments.serviceId,
    serviceRouteRef: services.routeRef,
    artifactRef: deployments.artifactRef,
    bundleR2Key: deployments.bundleR2Key,
    wasmR2Key: deployments.wasmR2Key,
    runtimeConfigSnapshotJson: deployments.runtimeConfigSnapshotJson,
    bindingsSnapshotEncrypted: deployments.bindingsSnapshotEncrypted,
    envVarsSnapshotEncrypted: deployments.envVarsSnapshotEncrypted,
    targetJson: deployments.targetJson,
  })
    .from(deployments)
    .innerJoin(services, eq(services.id, deployments.serviceId))
    .where(inArray(deployments.routingStatus, LOCAL_ROUTING_STATUSES))
    .orderBy(desc(deployments.version))
    .all();

  const matchedDeployments = candidateDeployments.filter((deployment) => {
    const deploymentRouteRef = parseDeploymentRouteRef(deployment.targetJson);
    return deploymentRouteRef === workerRef;
  });

  if (matchedDeployments.length > 1) {
    throw new Error(`Ambiguous local tenant route ref: ${workerRef}`);
  }

  const matchedDeployment = matchedDeployments[0];

  if (!matchedDeployment?.artifactRef || !matchedDeployment.bundleR2Key) return null;
  return {
    id: matchedDeployment.id,
    serviceId: matchedDeployment.serviceId,
    routeRef: matchedDeployment.serviceRouteRef ?? workerRef,
    artifactRef: matchedDeployment.artifactRef,
    bundleR2Key: matchedDeployment.bundleR2Key,
    wasmR2Key: matchedDeployment.wasmR2Key,
    runtimeConfigSnapshotJson: matchedDeployment.runtimeConfigSnapshotJson,
    bindingsSnapshotEncrypted: matchedDeployment.bindingsSnapshotEncrypted,
    envVarsSnapshotEncrypted: matchedDeployment.envVarsSnapshotEncrypted,
  };
}

async function loadBundleContent(
  workerBundles: R2Bucket,
  deployment: DeploymentRuntimeRecord,
  bundleCacheRoot: string,
): Promise<PreparedBundle> {
  const bundleObject = await workerBundles.get(deployment.bundleR2Key);
  if (!bundleObject) {
    throw new Error(`Bundle not found at ${deployment.bundleR2Key}`);
  }

  const bundleContent = await bundleObject.text();
  const workerDir = path.join(bundleCacheRoot, sanitizeWorkerRef(deployment.artifactRef));
  await mkdir(workerDir, { recursive: true });
  const scriptPath = path.join(workerDir, 'bundle.mjs');
  await writeFile(scriptPath, bundleContent, 'utf8');

  if (deployment.wasmR2Key) {
    const wasmObject = await workerBundles.get(deployment.wasmR2Key);
    if (wasmObject) {
      await writeFile(path.join(workerDir, 'module.wasm'), Buffer.from(await wasmObject.arrayBuffer()));
    }
  }

  return {
    bundleContent,
    workerDir,
    scriptPath,
  };
}

function createMissingBindingFetcher(kind: string, name: string): Fetcher {
  return {
    async fetch(): Promise<Response> {
      return Response.json({
        error: `Local ${kind} target not configured`,
        target: name,
      }, { status: 503 });
    },
    connect(): never {
      throw new Error(`Local ${kind} target not configured: ${name}`);
    },
  } as unknown as Fetcher;
}

function normalizeFetcherInput(
  input: RequestInfo | URL,
  init?: RequestInit,
): [string | URL, RequestInit | undefined] {
  if (input instanceof Request) {
    const body = input.method === 'GET' || input.method === 'HEAD'
      ? undefined
      : input.clone().body;
    return [input.url, {
      method: input.method,
      headers: input.headers,
      body,
      redirect: input.redirect,
    }];
  }

  return [input, init];
}

export async function createLocalTenantRuntimeRegistry(options: LocalTenantWorkerRegistryOptions): Promise<{
  get(name: string, registryOptions?: { deploymentId?: string }): TenantWorkerFetcher;
  dispatchScheduled(
    name: string,
    scheduledOptions?: TenantWorkerScheduledOptions,
    registryOptions?: { deploymentId?: string },
  ): Promise<TenantWorkerScheduledResult>;
  dispatchQueue(
    name: string,
    queueName: string,
    messages: TenantWorkerQueueMessage[],
    registryOptions?: { deploymentId?: string },
  ): Promise<TenantWorkerQueueResult>;
  invokeWorkflow(
    name: string,
    invocation: TenantWorkflowInvocation,
    registryOptions?: { deploymentId?: string },
  ): Promise<never>;
  dispose(): Promise<void>;
}> {
  const miniflareModule = await import('miniflare');
  const { Miniflare } = miniflareModule as unknown as MiniflareModule;
  const bundleCacheRoot = resolveRoot(options.bundleCacheRoot, 'bundles');
  const deploymentRuntimeCache = new Map<string, Promise<ResolvedTenantWorker>>();

  const resolveExternalFetcher = (name: string): FetcherLike => {
    const target = options.serviceTargets?.[name];
    if (target) return createForwardingFetcher(target) as unknown as FetcherLike;
    return createMissingBindingFetcher('service', name) as unknown as FetcherLike;
  };

  const registry: TenantWorkerRuntimeRegistry = {
    get(name: string, registryOptions?: { deploymentId?: string }): TenantWorkerFetcher {
      const lazyFetcher = {
        async fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
          const resolved = await getOrCreateWorker(name, registryOptions);
          const [normalizedInput, normalizedInit] = normalizeFetcherInput(input, init);
          return resolved.fetcher.fetch(
            normalizedInput as never,
            normalizedInit as never,
          ) as unknown as Promise<Response>;
        },
        async scheduled(scheduledOptions?: TenantWorkerScheduledOptions): Promise<TenantWorkerScheduledResult> {
          return registry.dispatchScheduled(name, scheduledOptions, registryOptions);
        },
        async queue(
          queueName: string,
          messages: TenantWorkerQueueMessage[],
        ): Promise<TenantWorkerQueueResult> {
          return registry.dispatchQueue(name, queueName, messages, registryOptions);
        },
        connect(): never {
          throw new Error('connect() is not supported by the local tenant runtime registry');
        },
      };
      return lazyFetcher as unknown as TenantWorkerFetcher;
    },
    async dispatchScheduled(
      name: string,
      scheduledOptions?: TenantWorkerScheduledOptions,
      registryOptions?: { deploymentId?: string },
    ): Promise<TenantWorkerScheduledResult> {
      const resolved = await getOrCreateWorker(name, registryOptions);
      if (typeof resolved.fetcher.scheduled !== 'function') {
        throw new Error(`Local tenant runtime does not expose scheduled() for ${name}`);
      }
      return resolved.fetcher.scheduled(scheduledOptions);
    },
    async dispatchQueue(
      name: string,
      queueName: string,
      messages: TenantWorkerQueueMessage[],
      registryOptions?: { deploymentId?: string },
    ): Promise<TenantWorkerQueueResult> {
      const resolved = await getOrCreateWorker(name, registryOptions);
      if (typeof resolved.fetcher.queue !== 'function') {
        throw new Error(`Local tenant runtime does not expose queue() for ${name}`);
      }
      return resolved.fetcher.queue(queueName, messages);
    },
    async invokeWorkflow(
      name: string,
      invocation: TenantWorkflowInvocation,
      registryOptions?: { deploymentId?: string },
    ): Promise<never> {
      void name;
      void invocation;
      void registryOptions;
      throw new Error(
        'Local tenant workflow runtime is not implemented yet. ' +
        'Takos currently supports tenant fetch/queue/scheduled handlers in local mode, ' +
        'but workflow export invocation still requires a dedicated Takos-managed runner.',
      );
    },
    async dispose(): Promise<void> {
      const resolved = await Promise.allSettled(deploymentRuntimeCache.values());
      await Promise.all(resolved.map(async (result) => {
        if (result.status === 'fulfilled') {
          await result.value.runtime.dispose();
        }
      }));
      deploymentRuntimeCache.clear();
    },
  };

  async function getOrCreateWorker(
    workerRef: string,
    registryOptions?: { deploymentId?: string },
  ): Promise<ResolvedTenantWorker> {
    const deployment = await resolveDeploymentRuntime(options.db, workerRef, registryOptions);
    if (!deployment) {
      throw new Error(`Worker not found: ${workerRef}${registryOptions?.deploymentId ? ` (${registryOptions.deploymentId})` : ''}`);
    }

    const cacheKey = deployment.id;
    const cached = deploymentRuntimeCache.get(cacheKey);
    if (cached) return cached;

    const created = (async () => {
      if (!options.workerBundles) {
        throw new Error('WORKER_BUNDLES is not configured for local tenant runtime');
      }

      const [bindingsSnapshot, envVars] = await Promise.all([
        decryptBindingsSnapshot(deployment, options.encryptionKey),
        decryptEnvVarSnapshot(deployment, options.encryptionKey),
      ]);

      const runtimeConfig = parseRuntimeConfig(deployment.runtimeConfigSnapshotJson);
      const preparedBundle = await loadBundleContent(options.workerBundles, deployment, bundleCacheRoot);
      const workerPersistRoot = options.persistRoot
        ? path.join(resolveRoot(options.persistRoot, 'state'), sanitizeWorkerRef(deployment.artifactRef))
        : false;

      const plainBindings: Record<string, string> = { ...envVars };
      const d1Databases: Record<string, string> = {};
      const kvNamespaces: Record<string, string> = {};
      const polyfillBindings: PolyfillBindingEntry[] = [];
      const r2Buckets: Record<string, string> = {};
      const queueProducers: Record<string, string | { queueName: string; deliveryDelay?: number }> = {};
      const durableObjects: Record<string, string | { className: string; scriptName?: string; useSQLite?: boolean }> = {};
      const serviceBindings: Record<string, string | ((request: Request) => Promise<Response>)> = {};

      for (const binding of bindingsSnapshot) {
        const bindingType = (binding as WorkerBinding & { type: string }).type;
        switch (bindingType) {
          case 'plain_text':
          case 'secret_text':
            plainBindings[binding.name] = binding.text ?? '';
            break;
          case 'd1':
            if (binding.database_id) d1Databases[binding.name] = binding.database_id;
            break;
          case 'kv_namespace':
            if (binding.namespace_id) kvNamespaces[binding.name] = binding.namespace_id;
            break;
          case 'r2_bucket':
            if (binding.bucket_name) r2Buckets[binding.name] = binding.bucket_name;
            break;
          case 'vectorize': {
            if (!options.pgPool) {
              throw new Error(
                `Vectorize binding "${binding.name}" requires PostgreSQL with pgvector. ` +
                'Set POSTGRES_URL and PGVECTOR_ENABLED=true.',
              );
            }
            const { createPgVectorStore } = await import('../adapters/pgvector-store.ts');
            const vectorStore = createPgVectorStore({
              pool: options.pgPool,
              tableName: `vector_${binding.index_name ?? binding.name}`.replace(/[^a-z0-9_]/gi, '_'),
            });
            const rpcName = `__TAKOS_VECTORIZE_${binding.name}`;
            serviceBindings[rpcName] = createVectorizeServiceHandler(vectorStore);
            polyfillBindings.push({ name: binding.name, type: 'vectorize', rpcBindingName: rpcName });
            break;
          }
          case 'queue':
            queueProducers[binding.name] = typeof binding.delivery_delay === 'number'
              ? {
                  queueName: binding.queue_name || binding.name,
                  deliveryDelay: binding.delivery_delay,
                }
              : (binding.queue_name || binding.name);
            break;
          case 'analytics_engine': {
            const { createAnalyticsEngineBinding } = await import('../adapters/analytics-engine-binding.ts');
            const analyticsBinding = createAnalyticsEngineBinding({
              dataset: binding.dataset ?? binding.name,
              otelEndpoint: options.otelEndpoint,
            });
            const analyticsRpcName = `__TAKOS_ANALYTICS_${binding.name}`;
            serviceBindings[analyticsRpcName] = createAnalyticsServiceHandler(analyticsBinding);
            polyfillBindings.push({ name: binding.name, type: 'analytics_engine', rpcBindingName: analyticsRpcName });
            break;
          }
          case 'workflow': {
            const { createWorkflowBinding } = await import('../adapters/workflow-binding.ts');
            const workflowBinding = createWorkflowBinding({
              db: options.db,
              serviceId: deployment.serviceId,
              workflowName: binding.workflow_name ?? binding.name,
            });
            const workflowRpcName = `__TAKOS_WORKFLOW_${binding.name}`;
            serviceBindings[workflowRpcName] = createWorkflowServiceHandler(workflowBinding);
            polyfillBindings.push({ name: binding.name, type: 'workflow', rpcBindingName: workflowRpcName });
            break;
          }
          case 'durable_object_namespace':
            if (binding.class_name) {
              durableObjects[binding.name] = {
                className: binding.class_name,
                ...(binding.script_name ? { scriptName: binding.script_name } : {}),
                ...(workerPersistRoot ? { useSQLite: true } : {}),
              };
            }
            break;
          case 'service': {
            const serviceName = binding.service || binding.name;
            serviceBindings[binding.name] = async (request: Request) => {
              const target = options.serviceTargets?.[serviceName]
                ? resolveExternalFetcher(serviceName)
                : registry.get(serviceName);
              return target.fetch(request as never) as unknown as Promise<Response>;
            };
            break;
          }
        }
      }

      // -- Inject AI binding if OPENAI_API_KEY is available --
      if (options.openAiApiKey) {
        const { createOpenAiAiBinding } = await import('../adapters/openai-binding.ts');
        const aiBinding = createOpenAiAiBinding({
          apiKey: options.openAiApiKey,
          baseUrl: options.openAiBaseUrl,
        });
        const aiRpcName = '__TAKOS_AI';
        serviceBindings[aiRpcName] = createAiServiceHandler(aiBinding);
        // Only add polyfill if not already declared as a binding
        // (AI is auto-injected, not explicitly declared like vectorize)
        polyfillBindings.push({ name: 'AI', type: 'ai', rpcBindingName: aiRpcName });
      }

      // -- Generate wrapper script if polyfill bindings are needed --
      const resourceLimits = parseTenantResourceLimits();
      const wrapperSource = generateWrapperScript({
        bindings: polyfillBindings,
        maxSubrequests: resourceLimits.maxSubrequests || undefined,
      });

      let entryScript = preparedBundle.bundleContent;
      let entryScriptPath = 'bundle.mjs';

      if (wrapperSource) {
        // Write wrapper alongside bundle
        await writeFile(path.join(preparedBundle.workerDir, '__takos_entry.mjs'), wrapperSource, 'utf-8');
        entryScript = wrapperSource;
        entryScriptPath = '__takos_entry.mjs';
      }

      const mf = new Miniflare({
        name: deployment.artifactRef,
        rootPath: preparedBundle.workerDir,
        modules: true,
        modulesRoot: preparedBundle.workerDir,
        script: entryScript,
        scriptPath: entryScriptPath,
        compatibilityDate: runtimeConfig.compatibility_date ?? CF_COMPATIBILITY_DATE,
        compatibilityFlags: runtimeConfig.compatibility_flags ?? [],
        bindings: plainBindings,
        d1Databases,
        kvNamespaces,
        r2Buckets,
        queueProducers,
        durableObjects,
        serviceBindings,
        cachePersist: false,
        durableObjectsPersist: workerPersistRoot ? path.join(workerPersistRoot, 'durable-objects') : false,
        kvPersist: workerPersistRoot ? path.join(workerPersistRoot, 'kv') : false,
        r2Persist: workerPersistRoot ? path.join(workerPersistRoot, 'r2') : false,
        d1Persist: workerPersistRoot ? path.join(workerPersistRoot, 'd1') : false,
      });
      await mf.ready;
      const fetcher = await mf.getWorker();

      return { fetcher: fetcher as unknown as TenantWorkerFetcher, runtime: mf };
    })();

    deploymentRuntimeCache.set(cacheKey, created);
    try {
      return await created;
    } catch (error) {
      deploymentRuntimeCache.delete(cacheKey);
      throw error;
    }
  }

  return registry;
}
