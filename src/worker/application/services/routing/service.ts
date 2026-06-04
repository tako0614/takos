/**
 * Routing Service
 *
 * Hostname routing resolution, upsert, and deletion.
 * Delegates to resolver (pure parsing/selection) and cache (L1/L2/DO) modules.
 */

import type {
  ResolvedRouting,
  RoutingBindings,
  RoutingTarget,
} from "./routing-models.ts";
import type { PlatformExecutionContext } from "../../../shared/types/bindings.ts";

import { type Clock, systemClock } from "@takos/worker-platform-utils/clock";
import { logWarn } from "../../../shared/utils/logger.ts";

// Re-export public APIs from resolver and cache so existing consumers keep working.
export type { RoutingBindings } from "./routing-models.ts";

export {
  normalizeHostname,
  parseRoutingValue,
  selectDeploymentTargetFromRoutingTarget,
  selectHttpEndpointFromHttpEndpointSet,
  selectRouteRefFromHttpEndpointSet,
  selectRouteRefFromRoutingTarget,
} from "./resolver.ts";

import { normalizeHostname, parseRoutingValue } from "./resolver.ts";
import {
  buildKVPayload,
  DEFAULT_DO_TIMEOUT,
  DEFAULT_TOMBSTONE_TTL,
  deleteL1,
  doDeleteRecord,
  doGetRecord,
  doPutRecord,
  getL1,
  hasRoutingDO,
  hasRoutingStore,
  L2_KV_TTL,
  putL1,
  ROUTING_LOG_PREFIX,
  runBackground,
  shouldUseKvValue,
} from "./cache.ts";

export async function resolveHostnameRouting(options: {
  env: RoutingBindings;
  hostname: string;
  executionCtx?: PlatformExecutionContext;
  timeoutMs?: number;
  clock?: Clock;
}): Promise<ResolvedRouting> {
  const hostname = normalizeHostname(options.hostname);
  const nowMs = (options.clock ?? systemClock).now();

  const l1 = getL1(hostname, nowMs);
  if (l1) return { ...l1, source: "l1" };

  if (hasRoutingStore(options.env)) {
    const record = await options.env.ROUTING_STORE.getRecord(hostname);
    const tombstone = typeof record?.tombstoneUntil === "number" &&
      record.tombstoneUntil > nowMs;
    const resolved: ResolvedRouting = {
      target: tombstone ? null : (record?.target ?? null),
      tombstone,
      source: "store",
      record,
    };
    putL1(hostname, resolved, nowMs);
    return resolved;
  }

  if (!options.env.HOSTNAME_ROUTING) {
    throw new Error("HOSTNAME_ROUTING is not configured");
  }

  const kvRaw = await options.env.HOSTNAME_ROUTING.get(hostname);
  const kv = parseRoutingValue(kvRaw);
  const kvTombstone = typeof kv.tombstoneUntil === "number" &&
    kv.tombstoneUntil > nowMs;

  const envWithDo = hasRoutingDO(options.env) ? options.env : null;
  const timeoutMs = options.timeoutMs ?? DEFAULT_DO_TIMEOUT;

  const maybeResolveFromDo = async (): Promise<ResolvedRouting | null> => {
    if (!envWithDo) return null;
    try {
      const record = await doGetRecord(envWithDo, hostname, timeoutMs);
      if (!record) {
        return {
          target: null,
          tombstone: false,
          source: "do",
          kv,
          record: null,
        };
      }
      const tombstone = typeof record.tombstoneUntil === "number" &&
        record.tombstoneUntil > nowMs;
      return {
        target: tombstone ? null : record.target,
        tombstone,
        source: "do",
        kv,
        record,
      };
    } catch (err) {
      logWarn(`${ROUTING_LOG_PREFIX} DO get failed for ${hostname}`, {
        module: "services/routing",
        detail: err,
      });
      return null;
    }
  };

  // DO-primary with L1 + KV (L2) cache.
  if (kvTombstone) {
    const tombstone: ResolvedRouting = {
      target: null,
      tombstone: true,
      source: "kv",
      kv,
    };
    putL1(hostname, tombstone, nowMs);
    return tombstone;
  }

  if (shouldUseKvValue(kv, nowMs)) {
    const resolved: ResolvedRouting = {
      target: kv.target,
      tombstone: false,
      source: "kv",
      kv,
    };
    putL1(hostname, resolved, nowMs);
    return resolved;
  }

  const resolved = await maybeResolveFromDo();
  if (resolved) {
    // Best-effort kv store cache refresh from DO.
    if (resolved.record) {
      const doTarget = resolved.tombstone ? null : resolved.record.target;
      const payload = buildKVPayload({
        target: doTarget,
        updatedAt: nowMs,
        version: resolved.record.version,
        tombstoneUntil: resolved.record.tombstoneUntil,
      });
      const kvOpts = { expirationTtl: L2_KV_TTL };
      const task = options.env.HOSTNAME_ROUTING.put(hostname, payload, kvOpts)
        .catch((err: unknown) => {
          logWarn(
            `${ROUTING_LOG_PREFIX} KV cache refresh failed for ${hostname}`,
            { module: "services/routing", detail: err },
          );
        });
      options.executionCtx?.waitUntil?.(task);
    }

    putL1(hostname, resolved, nowMs);
    return resolved;
  }

  // DO unavailable: fall back to kv store (even if stale), but log.
  if (kv.target) {
    logWarn(
      `${ROUTING_LOG_PREFIX} DO unavailable; falling back to KV for ${hostname}`,
      { module: "services/routing" },
    );
    const fallback: ResolvedRouting = {
      target: kv.target,
      tombstone: false,
      source: "kv_fallback",
      kv,
    };
    putL1(hostname, fallback, nowMs);
    return fallback;
  }

  return { target: null, tombstone: false, source: "kv", kv };
}

export async function upsertHostnameRouting(options: {
  env: RoutingBindings;
  hostname: string;
  target: RoutingTarget;
  executionCtx?: PlatformExecutionContext;
  timeoutMs?: number;
  clock?: Clock;
}): Promise<void> {
  const hostname = normalizeHostname(options.hostname);
  const nowMs = (options.clock ?? systemClock).now();
  const timeoutMs = options.timeoutMs ?? DEFAULT_DO_TIMEOUT;
  deleteL1(hostname);

  if (hasRoutingStore(options.env)) {
    await options.env.ROUTING_STORE.putRecord(hostname, options.target, nowMs);
    return;
  }

  if (!options.env.HOSTNAME_ROUTING) {
    throw new Error("HOSTNAME_ROUTING is not configured");
  }

  // DO primary (required) + KV (L2) cache.
  if (!hasRoutingDO(options.env)) {
    throw new Error("ROUTING_DO is not configured");
  }

  await doPutRecord(options.env, hostname, options.target, nowMs, timeoutMs);

  const kvPayload = buildKVPayload({
    target: options.target,
    updatedAt: nowMs,
  });
  const kvTask = options.env.HOSTNAME_ROUTING.put(hostname, kvPayload, {
    expirationTtl: L2_KV_TTL,
  })
    .catch((err: unknown) => {
      logWarn(`${ROUTING_LOG_PREFIX} KV put failed for ${hostname}`, {
        module: "services/routing",
        detail: err,
      });
    });
  await runBackground(options.executionCtx, kvTask);
}

export async function deleteHostnameRouting(options: {
  env: RoutingBindings;
  hostname: string;
  executionCtx?: PlatformExecutionContext;
  tombstoneTtlMs?: number;
  timeoutMs?: number;
  clock?: Clock;
}): Promise<void> {
  const hostname = normalizeHostname(options.hostname);
  const nowMs = (options.clock ?? systemClock).now();
  const tombstoneTtlMs = options.tombstoneTtlMs ?? DEFAULT_TOMBSTONE_TTL;
  const timeoutMs = options.timeoutMs ?? DEFAULT_DO_TIMEOUT;
  deleteL1(hostname);

  if (hasRoutingStore(options.env)) {
    await options.env.ROUTING_STORE.deleteRecord(
      hostname,
      tombstoneTtlMs,
      nowMs,
    );
    return;
  }

  if (!options.env.HOSTNAME_ROUTING) {
    throw new Error("HOSTNAME_ROUTING is not configured");
  }

  if (!hasRoutingDO(options.env)) {
    throw new Error("ROUTING_DO is not configured");
  }

  await doDeleteRecord(options.env, hostname, tombstoneTtlMs, nowMs, timeoutMs);

  const tombstoneUntil = nowMs + tombstoneTtlMs;
  const kvPayload = buildKVPayload({
    target: null,
    updatedAt: nowMs,
    tombstoneUntil,
  });
  const kvTask = options.env.HOSTNAME_ROUTING.put(hostname, kvPayload, {
    expirationTtl: L2_KV_TTL,
  }).catch(
    (err: unknown) => {
      logWarn(`${ROUTING_LOG_PREFIX} KV tombstone put failed for ${hostname}`, {
        module: "services/routing",
        detail: err,
      });
    },
  );
  await runBackground(options.executionCtx, kvTask);
}
