import path from 'node:path';
import { writeFile } from 'node:fs/promises';
import type { Fetcher } from '../shared/types/bindings.ts';
import type { WorkerBinding } from '../application/services/wfp/index.ts';
import { CF_COMPATIBILITY_DATE } from '../shared/constants/app.ts';
import { createForwardingFetcher } from './url-registry.ts';
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
import {
  type FetcherLike,
  type LocalTenantWorkerRegistryOptions,
  resolveRoot,
  sanitizeWorkerRef,
  parseRuntimeConfig,
  decryptBindingsSnapshot,
  decryptEnvVarSnapshot,
  resolveDeploymentRuntime,
  loadBundleContent,
  createMissingBindingFetcher,
  normalizeFetcherInput,
} from './miniflare-bindings.ts';

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
