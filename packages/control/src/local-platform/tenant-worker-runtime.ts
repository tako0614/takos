import path from 'node:path';
import type { D1Database, Fetcher, R2Bucket } from '../shared/types/bindings.ts';
import type { ServiceTargetMap } from './url-registry.ts';

export type TenantWorkerRuntimeFactoryOptions = {
  db: D1Database;
  workerBundles?: R2Bucket;
  encryptionKey?: string;
  bundleCacheRoot?: string | null;
  persistRoot?: string | null;
  serviceTargets?: ServiceTargetMap;
};

export type TenantWorkerRuntimeRegistry = {
  get(name: string, options?: { deploymentId?: string }): Fetcher;
  dispose(): Promise<void>;
};

export type LocalTenantWorkerRuntimeFactoryOptions = {
  dataDir?: string | null;
} & Omit<TenantWorkerRuntimeFactoryOptions, 'bundleCacheRoot' | 'persistRoot'>;

type LocalRuntimeRegistryModule = typeof import('./miniflare-registry.ts');

function resolveLocalPersistenceRoots(dataDir?: string | null) {
  if (!dataDir) {
    return {
      bundleCacheRoot: null,
      persistRoot: null,
    };
  }

  return {
    bundleCacheRoot: path.join(dataDir, 'tenant-runtime', 'bundles'),
    persistRoot: path.join(dataDir, 'tenant-runtime', 'state'),
  };
}

export async function createLocalTenantWorkerRuntimeRegistry(
  options: LocalTenantWorkerRuntimeFactoryOptions,
): Promise<TenantWorkerRuntimeRegistry> {
  const { bundleCacheRoot, persistRoot } = resolveLocalPersistenceRoots(options.dataDir);
  const registryOptions: TenantWorkerRuntimeFactoryOptions = {
    ...options,
    bundleCacheRoot,
    persistRoot,
  };

  let registryPromise: Promise<TenantWorkerRuntimeRegistry> | null = null;
  const fetchers = new Map<string, Fetcher>();

  const loadRegistry = async (): Promise<TenantWorkerRuntimeRegistry> => {
    if (!registryPromise) {
      const module = await import('./miniflare-registry.ts') as LocalRuntimeRegistryModule;
      registryPromise = module.createLocalTenantRuntimeRegistry(registryOptions);
    }
    return registryPromise;
  };

  return {
    get(name: string, options?: { deploymentId?: string }): Fetcher {
      const cacheKey = `${name}:${options?.deploymentId ?? ''}`;
      const cached = fetchers.get(cacheKey);
      if (cached) return cached;

      const lazyFetcher = {
        async fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
          const registry = await loadRegistry();
          return registry.get(name, options).fetch(input as never, init as never) as unknown as Promise<Response>;
        },
        connect(): never {
          throw new Error('connect() is not supported by the local tenant runtime registry');
        },
      } as unknown as Fetcher;

      fetchers.set(cacheKey, lazyFetcher);
      return lazyFetcher;
    },
    async dispose(): Promise<void> {
      if (!registryPromise) return;
      const registry = await registryPromise;
      await registry.dispose();
    },
  };
}
