import os from 'node:os';
import path from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import { and, desc, eq } from 'drizzle-orm';
import type { D1Database, Fetcher, R2Bucket } from '../shared/types/bindings.ts';
import type { WorkerBinding } from '../application/services/wfp/index.ts';
import { deployments, getDb, serviceDeployments } from '../infra/db/index.ts';
import { services } from '../infra/db/schema-services';
import { CF_COMPATIBILITY_DATE } from '../shared/constants.ts';
import { decrypt, decryptEnvVars, type EncryptedData } from '../shared/utils/crypto.ts';
import { createForwardingFetcher, type ServiceTargetMap } from './url-registry.ts';

type FetcherLike = Fetcher;

type DebugTenantWorkerRegistryOptions = {
  db: D1Database;
  workerBundles?: R2Bucket;
  encryptionKey?: string;
  bundleCacheRoot?: string | null;
  persistRoot?: string | null;
  serviceTargets?: ServiceTargetMap;
};

type DeploymentRuntimeRecord = {
  id: string;
  routeRef: string;
  artifactRef: string;
  bundleR2Key: string;
  wasmR2Key: string | null;
  runtimeConfigSnapshotJson: string;
  bindingsSnapshotEncrypted: string | null;
  envVarsSnapshotEncrypted: string | null;
};

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
  fetcher: Fetcher;
  runtime: MiniflareInstance;
};

type PreparedBundle = {
  bundleContent: string;
  workerDir: string;
  scriptPath: string;
};

function resolveRoot(explicit: string | null | undefined, suffix: string): string {
  return explicit && explicit.trim()
    ? path.resolve(explicit, suffix)
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
): Promise<DeploymentRuntimeRecord | null> {
  const db = getDb(dbBinding);
  const byArtifact = await db.select({
    id: deployments.id,
    routeRef: services.routeRef,
    artifactRef: deployments.artifactRef,
    bundleR2Key: deployments.bundleR2Key,
    wasmR2Key: deployments.wasmR2Key,
    runtimeConfigSnapshotJson: deployments.runtimeConfigSnapshotJson,
    bindingsSnapshotEncrypted: deployments.bindingsSnapshotEncrypted,
    envVarsSnapshotEncrypted: deployments.envVarsSnapshotEncrypted,
  })
    .from(deployments)
    .innerJoin(services, eq(services.id, serviceDeployments.serviceId))
    .where(and(
      eq(deployments.artifactRef, workerRef),
      eq(deployments.routingStatus, 'active'),
    ))
    .orderBy(desc(deployments.version))
    .get();

  if (byArtifact?.artifactRef && byArtifact.bundleR2Key) {
    return {
      id: byArtifact.id,
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

  if (!byWorker?.artifactRef || !byWorker.bundleR2Key) return null;
  return {
    id: byWorker.id,
    routeRef: byWorker.routeRef ?? workerRef,
    artifactRef: byWorker.artifactRef,
    bundleR2Key: byWorker.bundleR2Key,
    wasmR2Key: byWorker.wasmR2Key,
    runtimeConfigSnapshotJson: byWorker.runtimeConfigSnapshotJson,
    bindingsSnapshotEncrypted: byWorker.bindingsSnapshotEncrypted,
    envVarsSnapshotEncrypted: byWorker.envVarsSnapshotEncrypted,
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

export async function createDebugTenantRuntimeRegistry(options: DebugTenantWorkerRegistryOptions): Promise<{
  get(name: string): Fetcher;
  dispose(): Promise<void>;
}> {
  const miniflareModule = await import('miniflare');
  const { Miniflare } = miniflareModule as unknown as MiniflareModule;
  const bundleCacheRoot = resolveRoot(options.bundleCacheRoot, 'bundles');
  const fetcherCache = new Map<string, Promise<ResolvedTenantWorker>>();

  const resolveExternalFetcher = (name: string): FetcherLike => {
    const target = options.serviceTargets?.[name];
    if (target) return createForwardingFetcher(target) as unknown as FetcherLike;
    return createMissingBindingFetcher('service', name) as unknown as FetcherLike;
  };

  const registry = {
    get(name: string): Fetcher {
      const lazyFetcher = {
        async fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
          const resolved = await getOrCreateWorker(name);
          const [normalizedInput, normalizedInit] = normalizeFetcherInput(input, init);
          return resolved.fetcher.fetch(
            normalizedInput as never,
            normalizedInit as never,
          ) as unknown as Promise<Response>;
        },
        connect(): never {
          throw new Error('connect() is not supported by the local debug tenant runtime registry');
        },
      };
      return lazyFetcher as unknown as Fetcher;
    },
    async dispose(): Promise<void> {
      const resolved = await Promise.allSettled(fetcherCache.values());
      await Promise.all(resolved.map(async (result) => {
        if (result.status === 'fulfilled') {
          await result.value.runtime.dispose();
        }
      }));
      fetcherCache.clear();
    },
  };

  async function getOrCreateWorker(workerRef: string): Promise<ResolvedTenantWorker> {
    const cached = fetcherCache.get(workerRef);
    if (cached) return cached;

    const created = (async () => {
      if (!options.workerBundles) {
        throw new Error('WORKER_BUNDLES is not configured for local tenant runtime');
      }

      const deployment = await resolveDeploymentRuntime(options.db, workerRef);
      if (!deployment) {
        throw new Error(`Worker not found: ${workerRef}`);
      }

      const [bindingsSnapshot, envVars] = await Promise.all([
        decryptBindingsSnapshot(deployment, options.encryptionKey),
        decryptEnvVarSnapshot(deployment, options.encryptionKey),
      ]);

      const runtimeConfig = parseRuntimeConfig(deployment.runtimeConfigSnapshotJson);
      const preparedBundle = await loadBundleContent(options.workerBundles, deployment, bundleCacheRoot);

      const plainBindings: Record<string, string> = { ...envVars };
      const d1Databases: Record<string, string> = {};
      const kvNamespaces: Record<string, string> = {};
      const r2Buckets: Record<string, string> = {};
      const serviceBindings: Record<string, string | ((request: Request) => Promise<Response>)> = {};

      for (const binding of bindingsSnapshot) {
        switch (binding.type) {
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

      const mf = new Miniflare({
        name: deployment.artifactRef,
        rootPath: preparedBundle.workerDir,
        modules: true,
        modulesRoot: preparedBundle.workerDir,
        script: preparedBundle.bundleContent,
        scriptPath: 'bundle.mjs',
        compatibilityDate: runtimeConfig.compatibility_date ?? CF_COMPATIBILITY_DATE,
        compatibilityFlags: runtimeConfig.compatibility_flags ?? [],
        bindings: plainBindings,
        d1Databases,
        kvNamespaces,
        r2Buckets,
        serviceBindings,
        cachePersist: false,
        durableObjectsPersist: false,
        kvPersist: false,
        r2Persist: false,
        d1Persist: false,
      });
      await mf.ready;
      const fetcher = await mf.getWorker();

      return { fetcher: fetcher as unknown as Fetcher, runtime: mf };
    })();

    fetcherCache.set(workerRef, created);
    try {
      return await created;
    } catch (error) {
      fetcherCache.delete(workerRef);
      throw error;
    }
  }

  return registry;
}
