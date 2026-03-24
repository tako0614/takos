import type { KvStoreBinding } from '../../../shared/types/bindings';

const BUCKET_DURATION_MS = 60_000; // 1-minute buckets

/**
 * Record a request outcome for rollout health tracking.
 * Uses per-isolate unique keys to avoid KV read-modify-write race conditions.
 * Each call writes a new KV entry; getErrorRate aggregates them.
 */
export async function recordRequestOutcome(
  kv: KvStoreBinding,
  artifactRef: string,
  isError: boolean,
): Promise<void> {
  const minute = Math.floor(Date.now() / BUCKET_DURATION_MS);
  // Append-only: unique key per event avoids race conditions
  const key = `rollout:h:${artifactRef}:${minute}:${crypto.randomUUID()}`;
  await kv.put(key, isError ? '1' : '0', { expirationTtl: 1800 });
}

/**
 * Get aggregated error rate for a deployment over the given time window.
 */
export async function getErrorRate(
  kv: KvStoreBinding,
  artifactRef: string,
  windowMinutes: number = 5,
): Promise<{ errorRate: number; totalRequests: number; totalErrors: number }> {
  const now = Math.floor(Date.now() / BUCKET_DURATION_MS);
  let totalRequests = 0;
  let totalErrors = 0;

  for (let i = 0; i < windowMinutes; i++) {
    const prefix = `rollout:h:${artifactRef}:${now - i}:`;
    const list = await kv.list({ prefix });
    for (const key of list.keys) {
      totalRequests++;
      const val = await kv.get(key.name);
      if (val === '1') totalErrors++;
    }
  }

  return {
    errorRate: totalRequests > 0 ? totalErrors / totalRequests : 0,
    totalRequests,
    totalErrors,
  };
}
