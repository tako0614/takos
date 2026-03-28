/**
 * Dispatch env helpers — service registry, forwarding targets, tenant worker runtime.
 */
import { optionalEnv } from './env-helpers.ts';
import type { DispatchEnv } from '../../dispatch.ts';
import type { D1Database, R2Bucket, ServiceBindingFetcher } from '../../shared/types/bindings.ts';
import {
  createForwardingFetcher,
  createFetcherRegistry,
  parseServiceTargetMap,
  type ServiceTargetMap,
} from '../../local-platform/url-registry.ts';
import {
  createLocalTenantWorkerRuntimeRegistry,
  type TenantWorkerRuntimeRegistry,
} from '../../local-platform/tenant-worker-runtime.ts';
import type { PgPool } from './ai-resolver.ts';

// ---------------------------------------------------------------------------
// Forward target validation
// ---------------------------------------------------------------------------

const LOCAL_FORWARD_SERVICE_NAMES = new Set([
  'RUNTIME_HOST',
  'runtime-host',
  'EXECUTOR_HOST',
  'executor-host',
  'BROWSER_HOST',
  'browser-host',
  'TAKOS_EGRESS',
  'takos-egress',
]);

function validateLocalForwardTargets(targets: ServiceTargetMap): ServiceTargetMap {
  const invalidTargets = Object.keys(targets).filter((name) => !LOCAL_FORWARD_SERVICE_NAMES.has(name));
  if (invalidTargets.length > 0) {
    throw new Error(
      `TAKOS_LOCAL_DISPATCH_TARGETS_JSON may only override infra service targets: ${invalidTargets.join(', ')}`,
    );
  }
  return targets;
}

function createStrictLocalServiceRegistry(
  forwardTargets: ServiceTargetMap,
  tenantWorkerRuntimeRegistry: TenantWorkerRuntimeRegistry,
): DispatchEnv['DISPATCHER'] {
  return {
    get(name: string, options?: { deploymentId?: string }): ServiceBindingFetcher {
      const target = forwardTargets[name];
      if (target) {
        return createForwardingFetcher(target);
      }
      return tenantWorkerRuntimeRegistry.get(name, options) as unknown as ServiceBindingFetcher;
    },
  } as unknown as DispatchEnv['DISPATCHER'];
}

export function collectImplicitForwardTargets(): Record<string, string> {
  const targets: Record<string, string> = {};
  for (const [envKey, serviceName] of [
    ['TAKOS_LOCAL_RUNTIME_URL', 'runtime-host'],
    ['TAKOS_LOCAL_EXECUTOR_URL', 'executor-host'],
    ['TAKOS_LOCAL_BROWSER_URL', 'browser-host'],
    ['TAKOS_LOCAL_EGRESS_URL', 'takos-egress'],
    ['TAKOS_RUNTIME_HOST_URL', 'runtime-host'],
    ['TAKOS_EXECUTOR_HOST_URL', 'executor-host'],
    ['TAKOS_BROWSER_HOST_URL', 'browser-host'],
    ['TAKOS_EGRESS_URL', 'takos-egress'],
  ] as const) {
    const url = optionalEnv(envKey);
    if (url) {
      targets[serviceName] = url;
      targets[serviceName.toUpperCase().replace(/-/g, '_')] = url;
    }
  }
  return targets;
}

// ---------------------------------------------------------------------------
// Dispatcher builder
// ---------------------------------------------------------------------------

export interface DispatchBuildContext {
  dataDir: string | null;
  db: D1Database;
  workerBundles: R2Bucket;
  encryptionKey: string;
  pgPool: PgPool | undefined;
  forwardTargets: Record<string, string>;
  dispatchRegistries: Set<TenantWorkerRuntimeRegistry>;
}

export async function buildDispatcher(ctx: DispatchBuildContext): Promise<DispatchEnv['DISPATCHER']> {
  if (ctx.dataDir !== null) {
    // Local mode: forward targets + TenantWorkerRuntimeRegistry (Miniflare)
    const explicitTargets = validateLocalForwardTargets(
      parseServiceTargetMap(optionalEnv('TAKOS_LOCAL_DISPATCH_TARGETS_JSON')),
    );
    Object.assign(ctx.forwardTargets, explicitTargets);

    const tenantWorkerRuntimeRegistry = await createLocalTenantWorkerRuntimeRegistry({
      dataDir: ctx.dataDir,
      db: ctx.db,
      workerBundles: ctx.workerBundles,
      encryptionKey: ctx.encryptionKey,
      serviceTargets: ctx.forwardTargets,
      pgPool: ctx.pgPool,
      openAiApiKey: optionalEnv('OPENAI_API_KEY'),
      openAiBaseUrl: optionalEnv('OPENAI_BASE_URL'),
      otelEndpoint: optionalEnv('TAKOS_OTEL_ENDPOINT'),
    });
    ctx.dispatchRegistries.add(tenantWorkerRuntimeRegistry);
    return createStrictLocalServiceRegistry(ctx.forwardTargets, tenantWorkerRuntimeRegistry);
  }

  // Cloud mode: forward targets only (tenant execution delegated to external platform)
  return createFetcherRegistry(ctx.forwardTargets) as unknown as DispatchEnv['DISPATCHER'];
}
