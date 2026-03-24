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
  get(name: string): Fetcher;
  dispose(): Promise<void>;
};

export type DebugTenantWorkerRuntimeFactoryOptions = {
  dataDir?: string | null;
  debugRuntimeMode?: string | null;
} & Omit<TenantWorkerRuntimeFactoryOptions, 'bundleCacheRoot' | 'persistRoot'>;

type DebugRuntimeRegistryModule = typeof import('./miniflare-registry.ts');

function resolveDebugTenantRuntimeMode(explicitMode?: string | null): 'miniflare' | null {
  const rawMode = explicitMode
    ?? process.env.TAKOS_LOCAL_DEBUG_TENANT_RUNTIME
    ?? '';
  return rawMode.trim().toLowerCase() === 'miniflare' ? 'miniflare' : null;
}

function resolveDebugPersistenceRoots(dataDir?: string | null) {
  if (!dataDir) {
    return {
      bundleCacheRoot: null,
      persistRoot: null,
    };
  }

  return {
    bundleCacheRoot: path.join(dataDir, 'debug', 'miniflare', 'bundles'),
    persistRoot: path.join(dataDir, 'debug', 'miniflare', 'state'),
  };
}

export async function createDebugTenantWorkerRuntimeRegistry(
  options: DebugTenantWorkerRuntimeFactoryOptions,
): Promise<TenantWorkerRuntimeRegistry | null> {
  if (resolveDebugTenantRuntimeMode(options.debugRuntimeMode) !== 'miniflare') {
    return null;
  }

  const { bundleCacheRoot, persistRoot } = resolveDebugPersistenceRoots(options.dataDir);
  const registryOptions: TenantWorkerRuntimeFactoryOptions = {
    ...options,
    bundleCacheRoot,
    persistRoot,
  };

  let registryPromise: Promise<TenantWorkerRuntimeRegistry> | null = null;
  const fetchers = new Map<string, Fetcher>();

  const loadRegistry = async (): Promise<TenantWorkerRuntimeRegistry> => {
    if (!registryPromise) {
      const module = await import('./miniflare-registry.ts') as DebugRuntimeRegistryModule;
      registryPromise = module.createDebugTenantRuntimeRegistry(registryOptions);
    }
    return registryPromise;
  };

  return {
    get(name: string): Fetcher {
      const cached = fetchers.get(name);
      if (cached) return cached;

      const lazyFetcher = {
        async fetch(input: string | Request, init?: RequestInit): Promise<Response> {
          const registry = await loadRegistry();
          const fetcher = registry.get(name) as unknown as {
            fetch(request: string | Request, init?: RequestInit): Promise<Response>;
          };
          return fetcher.fetch(input, init);
        },
        connect(): never {
          throw new Error('connect() is not supported by the local tenant runtime registry');
        },
      } as unknown as Fetcher;

      fetchers.set(name, lazyFetcher);
      return lazyFetcher;
    },
    async dispose(): Promise<void> {
      if (!registryPromise) return;
      const registry = await registryPromise;
      await registry.dispose();
    },
  };
}
