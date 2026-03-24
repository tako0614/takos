import type { Env } from '../shared/types/index.ts';
import type { TenantWorkerRuntimeRegistry } from './tenant-worker-runtime.ts';
import type { ServiceTargetMap } from './url-registry.ts';

function resolveDebugTenantRuntimeMode(): 'miniflare' | null {
  const rawMode = process.env.TAKOS_LOCAL_DEBUG_TENANT_RUNTIME ?? '';
  return rawMode.trim().toLowerCase() === 'miniflare' ? 'miniflare' : null;
}

export async function createLocalDebugTenantWorkerRuntimeRegistry(options: {
  dataDir?: string | null;
  db: Env['DB'];
  workerBundles: Env['WORKER_BUNDLES'];
  encryptionKey?: string;
  serviceTargets: ServiceTargetMap;
}): Promise<TenantWorkerRuntimeRegistry | null> {
  if (resolveDebugTenantRuntimeMode() !== 'miniflare') {
    return null;
  }

  const { createDebugTenantWorkerRuntimeRegistry } = await import('./tenant-worker-runtime.ts');
  return createDebugTenantWorkerRuntimeRegistry(options) as Promise<TenantWorkerRuntimeRegistry | null>;
}
