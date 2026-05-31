import type { KvStoreBinding } from "../../../shared/types/bindings.ts";
import { type Clock, systemClock } from "@takos/worker-platform-utils/clock";

const BUCKET_DURATION_MS = 60_000; // 1-minute buckets

/**
 * Record a request outcome for rollout health tracking.
 * Uses per-isolate unique keys to avoid kv store read-modify-write race conditions.
 * Each call writes a new kv store entry; getErrorRate aggregates them.
 */
export async function recordRequestOutcome(
  kv: KvStoreBinding,
  artifactRef: string,
  isError: boolean,
  clock: Clock = systemClock,
): Promise<void> {
  const minute = Math.floor(clock.now() / BUCKET_DURATION_MS);
  // Append-only: unique key per event avoids race conditions
  const key = `rollout:h:${artifactRef}:${minute}:${crypto.randomUUID()}`;
  await kv.put(key, isError ? "1" : "0", { expirationTtl: 1800 });
}

/**
 * Get aggregated error rate for a deployment over the given time window.
 *
 * The KV `list` API is paginated (Cloudflare caps each page at ~1000 keys), so
 * we MUST follow the `cursor` until `list_complete` is true. Reading only the
 * first page would silently truncate the sample and let a high-error canary
 * pass the rollout health gate (advanceStageLocked) on a clipped denominator.
 */
export async function getErrorRate(
  kv: KvStoreBinding,
  artifactRef: string,
  windowMinutes: number = 5,
  clock: Clock = systemClock,
): Promise<{ errorRate: number; totalRequests: number; totalErrors: number }> {
  const now = Math.floor(clock.now() / BUCKET_DURATION_MS);
  let totalRequests = 0;
  let totalErrors = 0;

  for (let i = 0; i < windowMinutes; i++) {
    const prefix = `rollout:h:${artifactRef}:${now - i}:`;
    let cursor: string | undefined = undefined;
    do {
      const list = await kv.list({ prefix, cursor });
      // Read each page's values in parallel to bound latency; the per-request
      // append-only key scheme still implies an O(N) fanout, which is the
      // documented tradeoff (see recordRequestOutcome).
      const values = await Promise.all(
        list.keys.map((key) => kv.get(key.name)),
      );
      totalRequests += values.length;
      for (const val of values) {
        if (val === "1") totalErrors++;
      }
      cursor = list.list_complete ? undefined : list.cursor;
    } while (cursor);
  }

  return {
    errorRate: totalRequests > 0 ? totalErrors / totalRequests : 0,
    totalRequests,
    totalErrors,
  };
}
