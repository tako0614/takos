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

export { getRoutingPhase } from "./phase.ts";

import { normalizeHostname, parseRoutingValue } from "./resolver.ts";
import {
  buildKVPayload,
  DEFAULT_DO_TIMEOUT_MS,
  DEFAULT_TOMBSTONE_TTL_MS,
  deleteL1,
  doDeleteRecord,
  doGetRecord,
  doPutRecord,
  getL1,
  hasRoutingDO,
  hasRoutingStore,
  L2_KV_TTL_SECONDS,
  putL1,
  ROUTING_LOG_PREFIX,
  runBackground,
  shouldUseKvValue,
} from "./cache.ts";
import { getRoutingPhase } from "./phase.ts";

export async function resolveHostnameRouting(options: {
  env: RoutingBindings;
  hostname: string;
  executionCtx?: PlatformExecutionContext;
  timeoutMs?: number;
}): Promise<ResolvedRouting> {
  const hostname = normalizeHostname(options.hostname);
  const phase = getRoutingPhase(options.env);
  const nowMs = Date.now();

  if (phase >= 3) {
    const l1 = getL1(hostname, nowMs);
    if (l1) return { ...l1, source: "l1" };
  }

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
    if (phase >= 3) {
      putL1(hostname, resolved, nowMs);
    }
    return resolved;
  }

  if (!options.env.HOSTNAME_ROUTING) {
    throw new Error("HOSTNAME_ROUTING is not configured");
  }

  const kvRaw = await options.env.HOSTNAME_ROUTING.get(hostname);
  const kv = parseRoutingValue(kvRaw);
  const kvTombstone = typeof kv.tombstoneUntil === "number" &&
    kv.tombstoneUntil > nowMs;

  if (phase === 1) {
    return {
      target: kvTombstone ? null : kv.target,
      tombstone: kvTombstone,
      source: "kv",
      kv,
    };
  }

  const envWithDo = hasRoutingDO(options.env) ? options.env : null;
  const timeoutMs = options.timeoutMs ?? DEFAULT_DO_TIMEOUT_MS;

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

  // Phase 2: KV primary + DO verify (trust DO when available)
  if (phase === 2) {
    const resolved = await maybeResolveFromDo();

    // DO miss: use KV, and opportunistically backfill DO.
    if (resolved && !resolved.record && kv.target && envWithDo) {
      const task = doPutRecord(envWithDo, hostname, kv.target, nowMs, timeoutMs)
        .catch((err) => {
          logWarn(
            `${ROUTING_LOG_PREFIX} DO backfill put failed for ${hostname}`,
            { module: "services/routing", detail: err },
          );
        });
      options.executionCtx?.waitUntil?.(task);
      return {
        target: kv.target,
        tombstone: false,
        source: "kv",
        kv,
        record: null,
      };
    }

    // DO hit: compare and refresh KV cache if mismatched.
    if (resolved?.record) {
      const doTarget = resolved.tombstone ? null : resolved.record.target;
      const mismatch = JSON.stringify(kv.target) !== JSON.stringify(doTarget);
      if (mismatch) {
        logWarn(`${ROUTING_LOG_PREFIX} verify mismatch for ${hostname}`, {
          module: "services/routing",
          detail: {
            kv: kvRaw ? String(kvRaw).slice(0, 200) : null,
            do: resolved.record,
          },
        });

        // Refresh KV to DO truth (best-effort).
        const payload = buildKVPayload({
          target: doTarget,
          updatedAt: nowMs,
          version: resolved.record.version,
          tombstoneUntil: resolved.record.tombstoneUntil,
        });

        const task = options.env.HOSTNAME_ROUTING.put(hostname, payload).catch(
          (err: unknown) => {
            logWarn(`${ROUTING_LOG_PREFIX} KV refresh failed for ${hostname}`, {
              module: "services/routing",
              detail: err,
            });
          },
        );
        options.executionCtx?.waitUntil?.(task);
      }

      if (phase >= 3) {
        putL1(hostname, resolved, nowMs);
      }

      // Trust DO.
      return resolved;
    }

    // No DO available (or error): KV only.
    return {
      target: kvTombstone ? null : kv.target,
      tombstone: kvTombstone,
      source: "kv",
      kv,
    };
  }

  // Phase 3/4: caches + DO primary fallback
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
    // Best-effort KV cache refresh from DO.
    if (resolved.record) {
      const doTarget = resolved.tombstone ? null : resolved.record.target;
      const payload = buildKVPayload({
        target: doTarget,
        updatedAt: nowMs,
        version: resolved.record.version,
        tombstoneUntil: resolved.record.tombstoneUntil,
      });
      const kvOpts = phase >= 4
        ? { expirationTtl: L2_KV_TTL_SECONDS }
        : undefined;
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

  // DO unavailable: fall back to KV (even if stale), but log.
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
}): Promise<void> {
  const hostname = normalizeHostname(options.hostname);
  const phase = getRoutingPhase(options.env);
  const nowMs = Date.now();
  const timeoutMs = options.timeoutMs ?? DEFAULT_DO_TIMEOUT_MS;
  deleteL1(hostname);

  if (hasRoutingStore(options.env)) {
    await options.env.ROUTING_STORE.putRecord(hostname, options.target, nowMs);
    return;
  }

  if (!options.env.HOSTNAME_ROUTING) {
    throw new Error("HOSTNAME_ROUTING is not configured");
  }

  const kvPayload = buildKVPayload({
    target: options.target,
    updatedAt: nowMs,
  });
  const kvOpts = phase >= 4 ? { expirationTtl: L2_KV_TTL_SECONDS } : undefined;

  if (phase < 3) {
    await options.env.HOSTNAME_ROUTING.put(hostname, kvPayload, kvOpts);
    if (hasRoutingDO(options.env)) {
      const task = doPutRecord(
        options.env,
        hostname,
        options.target,
        nowMs,
        timeoutMs,
      ).catch((err) => {
        logWarn(`${ROUTING_LOG_PREFIX} DO put failed for ${hostname}`, {
          module: "services/routing",
          detail: err,
        });
      });
      await runBackground(options.executionCtx, task);
    }
    return;
  }

  // Phase 3/4: DO primary (required)
  if (!hasRoutingDO(options.env)) {
    throw new Error("ROUTING_DO is not configured");
  }

  await doPutRecord(options.env, hostname, options.target, nowMs, timeoutMs);

  const kvTask = options.env.HOSTNAME_ROUTING.put(hostname, kvPayload, kvOpts)
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
}): Promise<void> {
  const hostname = normalizeHostname(options.hostname);
  const phase = getRoutingPhase(options.env);
  const nowMs = Date.now();
  const tombstoneTtlMs = options.tombstoneTtlMs ?? DEFAULT_TOMBSTONE_TTL_MS;
  const timeoutMs = options.timeoutMs ?? DEFAULT_DO_TIMEOUT_MS;
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

  if (phase < 3) {
    await options.env.HOSTNAME_ROUTING.delete(hostname);
    if (hasRoutingDO(options.env)) {
      const task = doDeleteRecord(
        options.env,
        hostname,
        tombstoneTtlMs,
        nowMs,
        timeoutMs,
      ).catch((err) => {
        logWarn(`${ROUTING_LOG_PREFIX} DO delete failed for ${hostname}`, {
          module: "services/routing",
          detail: err,
        });
      });
      await runBackground(options.executionCtx, task);
    }
    return;
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
    expirationTtl: L2_KV_TTL_SECONDS,
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
