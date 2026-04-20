import path from "node:path";
import { writeFile } from "node:fs/promises";
import type { WorkerBinding } from "../application/services/wfp/index.ts";
import { CF_COMPATIBILITY_DATE } from "../shared/constants/app.ts";
import { createForwardingFetcher } from "./url-registry.ts";
import type {
  TenantWorkerFetcher,
  TenantWorkerQueueMessage,
  TenantWorkerQueueResult,
  TenantWorkerRuntimeRegistry,
  TenantWorkerScheduledOptions,
  TenantWorkerScheduledResult,
  TenantWorkflowInvocation,
  TenantWorkflowInvocationResult,
} from "./tenant-worker-runtime.ts";
import {
  createAiServiceHandler,
  createAnalyticsServiceHandler,
  createQueueServiceHandler,
  createVectorizeServiceHandler,
  createWorkflowServiceHandler,
} from "./tenant-binding-rpc.ts";
import {
  generateWrapperScript,
  type PolyfillBindingEntry,
} from "./tenant-binding-polyfills.ts";
import {
  createMissingBindingFetcher,
  decryptBindingsSnapshot,
  decryptEnvVarSnapshot,
  type FetcherLike,
  loadBundleContent,
  type LocalTenantWorkerRegistryOptions,
  normalizeFetcherInput,
  parseRuntimeConfig,
  resolveDeploymentRuntime,
  resolveRoot,
  sanitizeWorkerRef,
} from "./miniflare-bindings.ts";

type MiniflareInstance = {
  ready: Promise<void>;
  getWorker(): Promise<unknown>;
  dispose(): Promise<void>;
};

type MiniflareModule = {
  Miniflare: new (options: unknown) => MiniflareInstance;
};

function isMiniflareModule(value: unknown): value is MiniflareModule {
  return typeof value === "object" && value !== null &&
    typeof Reflect.get(value, "Miniflare") === "function";
}

function isTenantWorkerFetcher(value: unknown): value is TenantWorkerFetcher {
  return typeof value === "object" && value !== null &&
    typeof Reflect.get(value, "fetch") === "function" &&
    typeof Reflect.get(value, "scheduled") === "function" &&
    typeof Reflect.get(value, "queue") === "function";
}

type BackendQueueAdapter = {
  send(message: unknown, options?: { delaySeconds?: number }): Promise<void>;
  sendBatch(
    messages: Iterable<{ body: unknown; delaySeconds?: number }>,
  ): Promise<void>;
  receive?(): Promise<{ body: unknown; attempts?: number } | null>;
};

type LocalPlatformTestHooks = {
  __TAKOS_TEST_MINIFLARE__?: MiniflareModule;
  __TAKOS_TEST_BACKEND_QUEUE_ADAPTER__?: (
    binding: BackendQueueBinding,
  ) => Promise<BackendQueueAdapter | null> | BackendQueueAdapter | null;
};

type ResolvedTenantWorker = {
  fetcher: TenantWorkerFetcher;
  runtime: MiniflareInstance;
  dispose(): Promise<void>;
};

function getLocalPlatformTestHooks(): LocalPlatformTestHooks {
  return globalThis as typeof globalThis & LocalPlatformTestHooks;
}

function resolveMiniflareHost(): string {
  const explicit = Deno.env.get("TAKOS_MINIFLARE_HOST")?.trim();
  if (explicit) {
    return explicit;
  }
  return "0.0.0.0";
}

function resolveMiniflarePort(): number | undefined {
  const parsed = Number.parseInt(
    Deno.env.get("TAKOS_MINIFLARE_PORT")?.trim() ?? "",
    10,
  );
  if (Number.isFinite(parsed) && parsed > 0) {
    return parsed;
  }
  return undefined;
}

function resolveWorkflowBindingName(
  bindingsSnapshot: WorkerBinding[],
  exportName: string,
): string {
  const workflowBinding = bindingsSnapshot.find((binding) => {
    const candidate = binding as WorkerBinding & {
      type?: string;
      name?: string;
      workflow_name?: string;
      class_name?: string;
    };
    if (candidate.type !== "workflow") return false;
    return (
      candidate.class_name === exportName ||
      candidate.workflow_name === exportName ||
      candidate.name === exportName
    );
  });

  if (!workflowBinding) {
    return exportName;
  }

  const candidate = workflowBinding as WorkerBinding & {
    workflow_name?: string;
    name?: string;
  };
  return candidate.workflow_name ?? candidate.name ?? exportName;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

type BackendQueueBinding = WorkerBinding & {
  type: "queue";
  queue_backend?: "sqs" | "pubsub" | "redis" | "persistent";
  queue_name?: string;
  queue_url?: string;
  subscription_name?: string;
};

async function createBackendQueueAdapter(
  binding: BackendQueueBinding,
): Promise<BackendQueueAdapter | null> {
  const queueAdapterOverride = getLocalPlatformTestHooks()
    .__TAKOS_TEST_BACKEND_QUEUE_ADAPTER__;
  if (queueAdapterOverride) {
    return await queueAdapterOverride(binding);
  }

  switch (binding.queue_backend) {
    case "sqs": {
      if (!binding.queue_url) {
        throw new Error(
          `Queue binding "${binding.name}" requires queue_url for SQS`,
        );
      }
      const { createSqsQueue } = await import("../adapters/sqs-queue.ts");
      return createSqsQueue({
        region: Deno.env.get("AWS_REGION")?.trim() || "us-east-1",
        queueUrl: binding.queue_url,
        accessKeyId: Deno.env.get("AWS_ACCESS_KEY_ID")?.trim(),
        secretAccessKey: Deno.env.get("AWS_SECRET_ACCESS_KEY")?.trim(),
      });
    }
    case "pubsub": {
      const { createPubSubQueue } = await import("../adapters/pubsub-queue.ts");
      return createPubSubQueue({
        projectId: Deno.env.get("GCP_PROJECT_ID")?.trim(),
        keyFilePath: Deno.env.get("GOOGLE_APPLICATION_CREDENTIALS")?.trim(),
        topicName: binding.queue_name || binding.name,
        subscriptionName: binding.subscription_name,
      });
    }
    case "redis": {
      const redisUrl = Deno.env.get("REDIS_URL")?.trim();
      if (!redisUrl) {
        throw new Error(
          `Queue binding "${binding.name}" requires REDIS_URL for Redis-backed delivery`,
        );
      }
      const { createRedisQueue } = await import("./redis-bindings.ts");
      return createRedisQueue(redisUrl, binding.queue_name || binding.name);
    }
    case "persistent":
    default:
      return null;
  }
}

export async function createLocalTenantRuntimeRegistry(
  options: LocalTenantWorkerRegistryOptions,
): Promise<{
  get(
    name: string,
    registryOptions?: { deploymentId?: string },
  ): TenantWorkerFetcher;
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
  ): Promise<TenantWorkflowInvocationResult>;
  dispose(): Promise<void>;
}> {
  const miniflareModule =
    getLocalPlatformTestHooks().__TAKOS_TEST_MINIFLARE__ ??
      await import("miniflare");
  if (!isMiniflareModule(miniflareModule)) {
    throw new Error("Loaded miniflare module does not export Miniflare");
  }
  const { Miniflare } = miniflareModule;
  const bundleCacheRoot = resolveRoot(options.bundleCacheRoot, "bundles");
  const deploymentRuntimeCache = new Map<
    string,
    Promise<ResolvedTenantWorker>
  >();

  const resolveExternalFetcher = (name: string): FetcherLike => {
    const target = options.serviceTargets?.[name];
    if (target) {
      return createForwardingFetcher(target);
    }
    return createMissingBindingFetcher("service", name);
  };

  const registry: TenantWorkerRuntimeRegistry = {
    get(
      name: string,
      registryOptions?: { deploymentId?: string },
    ): TenantWorkerFetcher {
      const lazyFetcher: TenantWorkerFetcher = {
        async fetch(
          input: RequestInfo | URL,
          init?: RequestInit,
        ): Promise<Response> {
          const resolved = await getOrCreateWorker(name, registryOptions);
          const [normalizedInput, normalizedInit] = normalizeFetcherInput(
            input,
            init,
          );
          return resolved.fetcher.fetch(
            new Request(normalizedInput, normalizedInit),
          );
        },
        async scheduled(
          scheduledOptions?: TenantWorkerScheduledOptions,
        ): Promise<TenantWorkerScheduledResult> {
          return registry.dispatchScheduled(
            name,
            scheduledOptions,
            registryOptions,
          );
        },
        async queue(
          queueName: string,
          messages: TenantWorkerQueueMessage[],
        ): Promise<TenantWorkerQueueResult> {
          return registry.dispatchQueue(
            name,
            queueName,
            messages,
            registryOptions,
          );
        },
      };
      return lazyFetcher;
    },
    async dispatchScheduled(
      name: string,
      scheduledOptions?: TenantWorkerScheduledOptions,
      registryOptions?: { deploymentId?: string },
    ): Promise<TenantWorkerScheduledResult> {
      const resolved = await getOrCreateWorker(name, registryOptions);
      if (typeof resolved.fetcher.scheduled !== "function") {
        throw new Error(
          `Local tenant runtime does not expose scheduled() for ${name}`,
        );
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
      if (typeof resolved.fetcher.queue !== "function") {
        throw new Error(
          `Local tenant runtime does not expose queue() for ${name}`,
        );
      }
      return resolved.fetcher.queue(queueName, messages);
    },
    async invokeWorkflow(
      name: string,
      invocation: TenantWorkflowInvocation,
      registryOptions?: { deploymentId?: string },
    ): Promise<TenantWorkflowInvocationResult> {
      const deployment = await resolveDeploymentRuntime(
        options.db,
        name,
        registryOptions,
      );
      if (!deployment) {
        throw new Error(
          `Worker not found: ${name}${
            registryOptions?.deploymentId
              ? ` (${registryOptions.deploymentId})`
              : ""
          }`,
        );
      }

      const bindingsSnapshot = await decryptBindingsSnapshot(
        deployment,
        options.encryptionKey,
      );
      const workflowName = resolveWorkflowBindingName(
        bindingsSnapshot,
        invocation.exportName,
      );
      const { createWorkflowBinding } = await import(
        "../adapters/workflow-binding.ts"
      );
      const workflowBinding = createWorkflowBinding({
        db: options.db,
        serviceId: deployment.serviceId,
        workflowName,
      });
      const instance = await workflowBinding.create({
        params: invocation.payload,
      });
      const status = await instance.status();

      return {
        id: instance.id,
        workflowName,
        status: status.status,
        serviceId: deployment.serviceId,
        exportName: invocation.exportName,
      };
    },
    async dispose(): Promise<void> {
      const resolved = await Promise.allSettled(
        deploymentRuntimeCache.values(),
      );
      await Promise.all(resolved.map(async (result) => {
        if (result.status === "fulfilled") {
          await result.value.dispose();
        }
      }));
      deploymentRuntimeCache.clear();
    },
  };

  async function getOrCreateWorker(
    workerRef: string,
    registryOptions?: { deploymentId?: string },
  ): Promise<ResolvedTenantWorker> {
    const deployment = await resolveDeploymentRuntime(
      options.db,
      workerRef,
      registryOptions,
    );
    if (!deployment) {
      throw new Error(
        `Worker not found: ${workerRef}${
          registryOptions?.deploymentId
            ? ` (${registryOptions.deploymentId})`
            : ""
        }`,
      );
    }

    const cacheKey = deployment.id;
    const cached = deploymentRuntimeCache.get(cacheKey);
    if (cached) return cached;

    const created = (async () => {
      if (!options.workerBundles) {
        throw new Error(
          "WORKER_BUNDLES is not configured for local tenant runtime",
        );
      }

      const [bindingsSnapshot, envVars] = await Promise.all([
        decryptBindingsSnapshot(deployment, options.encryptionKey),
        decryptEnvVarSnapshot(deployment, options.encryptionKey),
      ]);

      const runtimeConfig = parseRuntimeConfig(
        deployment.runtimeConfigSnapshotJson,
      );
      const preparedBundle = await loadBundleContent(
        options.workerBundles,
        deployment,
        bundleCacheRoot,
      );
      const workerPersistRoot = options.persistRoot
        ? path.join(
          resolveRoot(options.persistRoot, "state"),
          sanitizeWorkerRef(deployment.artifactRef),
        )
        : false;

      const plainBindings: Record<string, string> = { ...envVars };
      const d1Databases: Record<string, string> = {};
      const kvNamespaces: Record<string, string> = {};
      const polyfillBindings: PolyfillBindingEntry[] = [];
      const r2Buckets: Record<string, string> = {};
      const queueProducers: Record<
        string,
        string | { queueName: string; deliveryDelay?: number }
      > = {};
      const durableObjects: Record<
        string,
        string | { className: string; scriptName?: string; useSQLite?: boolean }
      > = {};
      const serviceBindings: Record<
        string,
        string | ((request: Request) => Promise<Response>)
      > = {};
      const queueConsumers: Array<{
        bindingName: string;
        queueName: string;
        adapter: Awaited<ReturnType<typeof createBackendQueueAdapter>>;
      }> = [];

      for (const binding of bindingsSnapshot) {
        const bindingType = (binding as WorkerBinding & { type: string }).type;
        switch (bindingType) {
          case "plain_text":
          case "secret_text":
            plainBindings[binding.name] = binding.text ?? "";
            break;
          case "d1":
            if (binding.database_id) {
              d1Databases[binding.name] = binding.database_id;
            }
            break;
          case "kv_namespace":
            if (binding.namespace_id) {
              kvNamespaces[binding.name] = binding.namespace_id;
            }
            break;
          case "r2_bucket":
            if (binding.bucket_name) {
              r2Buckets[binding.name] = binding.bucket_name;
            }
            break;
          case "vectorize": {
            if (!options.pgPool) {
              throw new Error(
                `Vectorize binding "${binding.name}" requires PostgreSQL with pgvector. ` +
                  "Set POSTGRES_URL and PGVECTOR_ENABLED=true.",
              );
            }
            const { createPgVectorStore } = await import(
              "../adapters/pgvector-store.ts"
            );
            const vectorStore = createPgVectorStore({
              pool: options.pgPool,
              tableName: `vector_${binding.index_name ?? binding.name}`.replace(
                /[^a-z0-9_]/gi,
                "_",
              ),
            });
            const rpcName = `__TAKOS_VECTORIZE_${binding.name}`;
            serviceBindings[rpcName] = createVectorizeServiceHandler(
              vectorStore,
            );
            polyfillBindings.push({
              name: binding.name,
              type: "vectorize",
              rpcBindingName: rpcName,
            });
            break;
          }
          case "queue": {
            const backendQueue = await createBackendQueueAdapter(
              binding as BackendQueueBinding,
            );
            if (backendQueue) {
              const queueRpcName = `__TAKOS_QUEUE_${binding.name}`;
              serviceBindings[queueRpcName] = createQueueServiceHandler(
                backendQueue,
              );
              polyfillBindings.push({
                name: binding.name,
                type: "queue",
                rpcBindingName: queueRpcName,
              });
              if (typeof backendQueue.receive === "function") {
                queueConsumers.push({
                  bindingName: binding.name,
                  queueName: binding.queue_name || binding.name,
                  adapter: backendQueue,
                });
              }
              break;
            }
            queueProducers[binding.name] =
              typeof binding.delivery_delay === "number"
                ? {
                  queueName: binding.queue_name || binding.name,
                  deliveryDelay: binding.delivery_delay,
                }
                : (binding.queue_name || binding.name);
            break;
          }
          case "analytics_engine": {
            const { createAnalyticsEngineBinding } = await import(
              "../adapters/analytics-engine-binding.ts"
            );
            const analyticsBinding = createAnalyticsEngineBinding({
              dataset: binding.dataset ?? binding.name,
              otelEndpoint: options.otelEndpoint,
            });
            const analyticsRpcName = `__TAKOS_ANALYTICS_${binding.name}`;
            serviceBindings[analyticsRpcName] = createAnalyticsServiceHandler(
              analyticsBinding,
            );
            polyfillBindings.push({
              name: binding.name,
              type: "analytics_engine",
              rpcBindingName: analyticsRpcName,
            });
            break;
          }
          case "workflow": {
            const { createWorkflowBinding } = await import(
              "../adapters/workflow-binding.ts"
            );
            const workflowBinding = createWorkflowBinding({
              db: options.db,
              serviceId: deployment.serviceId,
              workflowName: binding.workflow_name ?? binding.name,
            });
            const workflowRpcName = `__TAKOS_WORKFLOW_${binding.name}`;
            serviceBindings[workflowRpcName] = createWorkflowServiceHandler(
              workflowBinding,
            );
            polyfillBindings.push({
              name: binding.name,
              type: "workflow",
              rpcBindingName: workflowRpcName,
            });
            break;
          }
          case "durable_object_namespace":
            if (binding.class_name) {
              durableObjects[binding.name] = {
                className: binding.class_name,
                ...(binding.script_name
                  ? { scriptName: binding.script_name }
                  : {}),
                ...(workerPersistRoot ? { useSQLite: true } : {}),
              };
            }
            break;
          case "service": {
            const serviceName = binding.service || binding.name;
            serviceBindings[binding.name] = async (request: Request) => {
              const target = options.serviceTargets?.[serviceName]
                ? resolveExternalFetcher(serviceName)
                : registry.get(serviceName);
              return target.fetch(request);
            };
            break;
          }
        }
      }

      // -- Inject AI binding if OPENAI_API_KEY is available --
      if (options.openAiApiKey) {
        const { createOpenAiAiBinding } = await import(
          "../adapters/openai-binding.ts"
        );
        const aiBinding = createOpenAiAiBinding({
          apiKey: options.openAiApiKey,
          baseUrl: options.openAiBaseUrl,
        });
        const aiRpcName = "__TAKOS_AI";
        serviceBindings[aiRpcName] = createAiServiceHandler(aiBinding);
        // Only add polyfill if not already declared as a binding
        // (AI is auto-injected, not explicitly declared like vectorize)
        polyfillBindings.push({
          name: "AI",
          type: "ai",
          rpcBindingName: aiRpcName,
        });
      }

      // -- Generate wrapper script if polyfill bindings are needed --
      const wrapperSource = generateWrapperScript({
        bindings: polyfillBindings,
      });

      let entryScript = preparedBundle.bundleContent;
      let entryScriptPath = "bundle.mjs";

      if (wrapperSource) {
        // Write wrapper alongside bundle
        await writeFile(
          path.join(preparedBundle.workerDir, "__takos_entry.mjs"),
          wrapperSource,
          "utf-8",
        );
        entryScript = wrapperSource;
        entryScriptPath = "__takos_entry.mjs";
      }

      const mf = new Miniflare({
        name: deployment.artifactRef,
        rootPath: preparedBundle.workerDir,
        modules: true,
        modulesRoot: preparedBundle.workerDir,
        script: entryScript,
        scriptPath: entryScriptPath,
        compatibilityDate: runtimeConfig.compatibility_date ??
          CF_COMPATIBILITY_DATE,
        compatibilityFlags: runtimeConfig.compatibility_flags ?? [],
        bindings: plainBindings,
        d1Databases,
        kvNamespaces,
        r2Buckets,
        queueProducers,
        durableObjects,
        serviceBindings,
        cachePersist: false,
        durableObjectsPersist: workerPersistRoot
          ? path.join(workerPersistRoot, "durable-objects")
          : false,
        kvPersist: workerPersistRoot
          ? path.join(workerPersistRoot, "kv")
          : false,
        r2Persist: workerPersistRoot
          ? path.join(workerPersistRoot, "r2")
          : false,
        d1Persist: workerPersistRoot
          ? path.join(workerPersistRoot, "d1")
          : false,
        host: resolveMiniflareHost(),
        ...(resolveMiniflarePort() === undefined
          ? {}
          : { port: resolveMiniflarePort() }),
      });
      await mf.ready;
      const fetcher = await mf.getWorker();
      if (!isTenantWorkerFetcher(fetcher)) {
        throw new Error(
          `Miniflare worker ${deployment.serviceId} does not expose the expected runtime handlers`,
        );
      }
      let disposed = false;
      const consumerLoops = queueConsumers.map(({ queueName, adapter }) =>
        (async () => {
          while (!disposed) {
            try {
              if (typeof adapter?.receive !== "function") {
                return;
              }
              const record = await adapter.receive();
              if (!record) {
                await sleep(250);
                continue;
              }
              const result = await fetcher.queue(queueName, [{
                id: crypto.randomUUID(),
                timestamp: new Date(),
                attempts: Math.max(1, record.attempts ?? 1),
                body: record.body,
              }]);
              if (
                result.retryBatch ||
                (Array.isArray(result.retryMessages) &&
                  result.retryMessages.length > 0) ||
                result.ackAll === false
              ) {
                await adapter.send(record.body, { delaySeconds: 0 });
              }
            } catch {
              if (disposed) {
                return;
              }
              await sleep(500);
            }
          }
        })()
      );

      return {
        fetcher,
        runtime: mf,
        async dispose(): Promise<void> {
          disposed = true;
          await Promise.allSettled(consumerLoops);
          await mf.dispose();
        },
      };
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
