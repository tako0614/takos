/**
 * Routing store resolver + routing seed logic for local/dev setups.
 */
import path from 'node:path';
import { optionalEnv } from './env-utils.ts';
import { createInMemoryRoutingStore, createPersistentRoutingStore } from '../../local-platform/routing-store.ts';
import { createRedisRoutingStore } from '../../local-platform/redis-bindings.ts';

// ---------------------------------------------------------------------------
// Routing store resolver
// ---------------------------------------------------------------------------

export function resolveRoutingStore(redisUrl: string | null, dataDir: string | null) {
  if (redisUrl) return createRedisRoutingStore(redisUrl);
  if (dataDir) return createPersistentRoutingStore(path.join(dataDir, 'routing', 'routing-store.json'));
  return createInMemoryRoutingStore();
}

// ---------------------------------------------------------------------------
// SSE Notifier resolver (for Node.js WebSocket alternative)
// ---------------------------------------------------------------------------

export async function resolveSseNotifier(redisUrl: string | null) {
  try {
    const { createSseNotifierService } = await import('../../worker-emulation/sse-notifier.ts');
    return await createSseNotifierService(redisUrl ?? undefined);
  } catch {
    return undefined;
  }
}

// ---------------------------------------------------------------------------
// Routing seed (for local / dev setups)
// ---------------------------------------------------------------------------

type RoutingRecordInput = {
  type?: 'deployments' | 'http-endpoint-set';
  deployments?: Array<{
    routeRef: string;
    weight?: number;
    deploymentId?: string;
    status?: 'active' | 'canary' | 'rollback';
  }>;
  endpoints?: Array<{
    name: string;
    routes: Array<{ pathPrefix?: string; methods?: string[] }>;
    target: { kind: 'service-ref'; ref: string } | { kind: 'http-url'; baseUrl: string };
    timeoutMs?: number;
  }>;
};

function parseRoutingSeed(raw: string | undefined): Record<string, RoutingRecordInput> {
  if (!raw) return {};
  const parsed = JSON.parse(raw) as unknown;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('TAKOS_LOCAL_ROUTING_JSON must be a JSON object');
  }
  return parsed as Record<string, RoutingRecordInput>;
}

function serializeRoutingValue(value: RoutingRecordInput): string {
  return JSON.stringify(value);
}

let seeded = false;

export async function ensureRoutingSeeded(
  getSharedState: () => Promise<{
    hostnameRouting: { put(key: string, value: string): Promise<void> };
    routingStore: {
      putRecord(
        hostname: string,
        target: unknown,
        timestamp: number,
      ): Promise<unknown>;
    };
  }>,
): Promise<void> {
  if (seeded) return;
  seeded = true;

  const shared = await getSharedState();
  const routingSeed = parseRoutingSeed(optionalEnv('TAKOS_LOCAL_ROUTING_JSON'));
  for (const [hostname, value] of Object.entries(routingSeed)) {
    await shared.hostnameRouting.put(hostname.toLowerCase(), serializeRoutingValue(value));
    const target = value.type === 'http-endpoint-set'
      ? { type: 'http-endpoint-set' as const, endpoints: value.endpoints ?? [] }
      : { type: 'deployments' as const, deployments: (value.deployments ?? []).map((deployment) => ({
          routeRef: deployment.routeRef,
          weight: deployment.weight ?? 100,
          ...(deployment.deploymentId ? { deploymentId: deployment.deploymentId } : {}),
          status: deployment.status ?? 'active',
        })) };
    await shared.routingStore.putRecord(hostname, target, Date.now());
  }
}

/**
 * Reset the seeded flag — called during state disposal.
 */
export function resetRoutingSeed(): void {
  seeded = false;
}
