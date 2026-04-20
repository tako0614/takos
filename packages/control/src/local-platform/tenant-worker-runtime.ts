import path from "node:path";
import type {
  D1Database,
  Fetcher,
  R2Bucket,
} from "../shared/types/bindings.ts";
import type { ServiceTargetMap } from "./url-registry.ts";

export type TenantWorkerScheduledOptions = {
  scheduledTime?: Date;
  cron?: string;
};

export type TenantWorkerScheduledResult = {
  outcome: string;
  noRetry: boolean;
};

export type TenantWorkerQueueMessage<Body = unknown> =
  & {
    id: string;
    timestamp: Date;
    attempts: number;
  }
  & (
    | { body: Body }
    | { serializedBody: ArrayBuffer | ArrayBufferView }
  );

export type TenantWorkerQueueResult = {
  outcome: string;
  ackAll: boolean;
  retryBatch: unknown;
  explicitAcks: string[];
  retryMessages: unknown[];
};

export type TenantWorkflowInvocation = {
  exportName: string;
  payload?: unknown;
};

export type TenantWorkflowInvocationResult = {
  id: string;
  workflowName: string;
  status:
    | "queued"
    | "running"
    | "paused"
    | "completed"
    | "errored"
    | "terminated";
  serviceId: string;
  exportName: string;
};

export type TenantWorkerFetcher = Fetcher & {
  scheduled(
    options?: TenantWorkerScheduledOptions,
  ): Promise<TenantWorkerScheduledResult>;
  queue(
    queueName: string,
    messages: TenantWorkerQueueMessage[],
  ): Promise<TenantWorkerQueueResult>;
};

export type TenantWorkerRuntimeFactoryOptions = {
  db: D1Database;
  workerBundles?: R2Bucket;
  encryptionKey?: string;
  bundleCacheRoot?: string | null;
  persistRoot?: string | null;
  serviceTargets?: ServiceTargetMap;
  /** PostgreSQL pool for pgvector-backed Vectorize bindings. */
  pgPool?: {
    query(
      text: string,
      values?: unknown[],
    ): Promise<{ rows: Record<string, unknown>[]; rowCount: number | null }>;
  };
  /** OpenAI API key for AI bindings (auto-injected to all tenant workers). */
  openAiApiKey?: string;
  /** OpenAI-compatible base URL for AI bindings. */
  openAiBaseUrl?: string;
  /** OTEL collector endpoint for Analytics Engine bindings. */
  otelEndpoint?: string;
};

export type TenantWorkerRuntimeRegistry = {
  get(name: string, options?: { deploymentId?: string }): TenantWorkerFetcher;
  dispatchScheduled(
    name: string,
    scheduledOptions?: TenantWorkerScheduledOptions,
    options?: { deploymentId?: string },
  ): Promise<TenantWorkerScheduledResult>;
  dispatchQueue(
    name: string,
    queueName: string,
    messages: TenantWorkerQueueMessage[],
    options?: { deploymentId?: string },
  ): Promise<TenantWorkerQueueResult>;
  invokeWorkflow(
    name: string,
    invocation: TenantWorkflowInvocation,
    options?: { deploymentId?: string },
  ): Promise<TenantWorkflowInvocationResult>;
  dispose(): Promise<void>;
};

export type LocalTenantWorkerRuntimeFactoryOptions = {
  dataDir?: string | null;
} & Omit<TenantWorkerRuntimeFactoryOptions, "bundleCacheRoot" | "persistRoot">;

function resolveLocalPersistenceRoots(dataDir?: string | null) {
  if (!dataDir) {
    return {
      bundleCacheRoot: null,
      persistRoot: null,
    };
  }

  return {
    bundleCacheRoot: path.join(dataDir, "tenant-runtime", "bundles"),
    persistRoot: path.join(dataDir, "tenant-runtime", "state"),
  };
}

export async function createLocalTenantWorkerRuntimeRegistry(
  options: LocalTenantWorkerRuntimeFactoryOptions,
): Promise<TenantWorkerRuntimeRegistry> {
  const { bundleCacheRoot, persistRoot } = resolveLocalPersistenceRoots(
    options.dataDir,
  );
  const registryOptions: TenantWorkerRuntimeFactoryOptions = {
    ...options,
    bundleCacheRoot,
    persistRoot,
  };

  let registryPromise: Promise<TenantWorkerRuntimeRegistry> | null = null;
  const fetchers = new Map<string, TenantWorkerFetcher>();

  const loadRegistry = async (): Promise<TenantWorkerRuntimeRegistry> => {
    if (!registryPromise) {
      const module = await import("./miniflare-registry.ts");
      registryPromise = module.createLocalTenantRuntimeRegistry(
        registryOptions,
      );
    }
    return registryPromise;
  };

  return {
    get(
      name: string,
      options?: { deploymentId?: string },
    ): TenantWorkerFetcher {
      const cacheKey = `${name}:${options?.deploymentId ?? ""}`;
      const cached = fetchers.get(cacheKey);
      if (cached) return cached as TenantWorkerFetcher;

      const lazyFetcher = {
        async fetch(
          input: RequestInfo | URL,
          init?: RequestInit,
        ): Promise<Response> {
          const registry = await loadRegistry();
          return registry.get(name, options).fetch(new Request(input, init));
        },
        async scheduled(
          scheduledOptions?: TenantWorkerScheduledOptions,
        ): Promise<TenantWorkerScheduledResult> {
          const registry = await loadRegistry();
          return registry.dispatchScheduled(name, scheduledOptions, options);
        },
        async queue(
          queueName: string,
          messages: TenantWorkerQueueMessage[],
        ): Promise<TenantWorkerQueueResult> {
          const registry = await loadRegistry();
          return registry.dispatchQueue(name, queueName, messages, options);
        },
        connect(): never {
          throw new Error(
            "connect() is not supported by the local tenant runtime registry",
          );
        },
      };

      fetchers.set(cacheKey, lazyFetcher);
      return lazyFetcher;
    },
    async dispatchScheduled(
      name: string,
      scheduledOptions?: TenantWorkerScheduledOptions,
      registryOptions?: { deploymentId?: string },
    ): Promise<TenantWorkerScheduledResult> {
      const registry = await loadRegistry();
      return registry.dispatchScheduled(
        name,
        scheduledOptions,
        registryOptions,
      );
    },
    async dispatchQueue(
      name: string,
      queueName: string,
      messages: TenantWorkerQueueMessage[],
      registryOptions?: { deploymentId?: string },
    ): Promise<TenantWorkerQueueResult> {
      const registry = await loadRegistry();
      return registry.dispatchQueue(name, queueName, messages, registryOptions);
    },
    async invokeWorkflow(
      name: string,
      invocation: TenantWorkflowInvocation,
      registryOptions?: { deploymentId?: string },
    ): Promise<TenantWorkflowInvocationResult> {
      const registry = await loadRegistry();
      return registry.invokeWorkflow(name, invocation, registryOptions);
    },
    async dispose(): Promise<void> {
      if (!registryPromise) return;
      const registry = await registryPromise;
      await registry.dispose();
    },
  };
}
