import { getRoutingDOStub } from './sharding';
import type {
  ParsedRoutingValue,
  ResolvedRouting,
  RoutingBindings,
  RoutingRecord,
  RoutingTarget,
  StoredHttpEndpoint,
} from './types';

export type { RoutingBindings } from './types';
import { logWarn } from '../../../shared/utils/logger';
import type { PlatformExecutionContext } from '../../../shared/types/bindings.ts';

const ROUTING_LOG_PREFIX = '[Routing]';

const DEFAULT_PHASE = 1;
const MIN_PHASE = 1;
const MAX_PHASE = 4;

const L1_TTL_MS = 10_000; // isolate local cache
const L1_MAX_ENTRIES = 2048;

// KV "freshness" is enforced in application logic (not relying on KV propagation).
const L2_MAX_AGE_MS = 90_000;

// Phase 4: KV is pure cache (short TTL)
const L2_KV_TTL_SECONDS = 120;

const DEFAULT_DO_TIMEOUT_MS = 1_000;

const DEFAULT_TOMBSTONE_TTL_MS = 2 * 60_000; // 2 minutes

type L1Entry = { expiresAt: number; value: ResolvedRouting };
const l1Cache = new Map<string, L1Entry>();

type RoutingNamespace = NonNullable<RoutingBindings['ROUTING_DO']>;
type RoutingEnvWithDo = RoutingBindings & { ROUTING_DO: RoutingNamespace };
type RoutingFetcherLike = {
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
};

export function getRoutingPhase(env: RoutingBindings): number {
  const raw = env.ROUTING_DO_PHASE;
  if (!raw) return DEFAULT_PHASE;
  const parsed = Number.parseInt(String(raw), 10);
  if (!Number.isFinite(parsed)) return DEFAULT_PHASE;
  return Math.min(MAX_PHASE, Math.max(MIN_PHASE, parsed));
}

function hasRoutingDO(env: RoutingBindings): env is RoutingEnvWithDo {
  return Boolean(env.ROUTING_DO);
}

function hasRoutingStore(env: RoutingBindings): env is RoutingBindings & { ROUTING_STORE: NonNullable<RoutingBindings['ROUTING_STORE']> } {
  return Boolean(env.ROUTING_STORE);
}

function normalizeHostname(hostname: string): string {
  return hostname.trim().toLowerCase();
}

function isRoutingTarget(value: unknown): value is RoutingTarget {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  if (v.type === 'deployments' && Array.isArray(v.deployments) && v.deployments.length > 0) {
    for (const entry of v.deployments) {
      if (!entry || typeof entry !== 'object') continue;
      const e = entry as Record<string, unknown>;
      if (typeof e.routeRef === 'string' && e.routeRef) {
        return true;
      }
    }
  }
  if (v.type === 'http-endpoint-set' && Array.isArray(v.endpoints) && v.endpoints.length > 0) return true;
  return false;
}

function toSingleDeploymentTarget(routeRef: string): RoutingTarget {
  return {
    type: 'deployments',
    deployments: [{ routeRef, weight: 100, status: 'active' }],
  };
}

function parseEpochMillis(raw: unknown): number | undefined {
  if (typeof raw === 'number' && Number.isFinite(raw) && raw > 0) return raw;
  if (typeof raw === 'string' && raw.trim()) {
    const asNum = Number(raw);
    if (Number.isFinite(asNum) && asNum > 0) return asNum;
    const asDate = Date.parse(raw);
    if (Number.isFinite(asDate) && asDate > 0) return asDate;
  }
  return undefined;
}

function coercePositiveInt(raw: unknown): number | null {
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    const n = Math.floor(raw);
    return n > 0 ? n : null;
  }
  if (typeof raw === 'string' && raw.trim()) {
    const parsed = Number(raw);
    if (!Number.isFinite(parsed)) return null;
    const n = Math.floor(parsed);
    return n > 0 ? n : null;
  }
  return null;
}

/**
 * Select a concrete worker name from a routing target.
 *
 * - `deployments`: weighted random selection (weight-based)
 */
export function selectRouteRefFromRoutingTarget(
  target: RoutingTarget,
  options?: { random?: () => number }
): string | null {
  if (target.type !== 'deployments') return null;

  const rng = options?.random ?? Math.random;
  const candidates: Array<{ routeRef: string; weight: number }> = [];

  for (const entry of target.deployments) {
    const routeRef = typeof entry?.routeRef === 'string' && entry.routeRef.length > 0
      ? entry.routeRef
      : '';
    if (!routeRef) continue;
    const weight = coercePositiveInt(entry.weight) ?? 0;
    if (weight <= 0) continue;
    candidates.push({ routeRef, weight });
  }

  if (candidates.length === 0) {
    // Fall back to the first valid route ref even if weight is missing/invalid.
    for (const entry of target.deployments) {
      const routeRef = typeof entry?.routeRef === 'string' && entry.routeRef.length > 0
        ? entry.routeRef
        : '';
      if (routeRef) return routeRef;
    }
    return null;
  }

  const total = candidates.reduce((sum, c) => sum + c.weight, 0);
  if (total <= 0) return candidates[0]?.routeRef ?? null;

  let r = rng() * total;
  for (const c of candidates) {
    r -= c.weight;
    if (r < 0) return c.routeRef;
  }
  return candidates[candidates.length - 1]?.routeRef ?? null;
}

/**
 * Select a worker name from an http-endpoint-set routing target.
 * Uses longest pathPrefix match among cloudflare.worker endpoints.
 */
export function selectHttpEndpointFromHttpEndpointSet(
  endpoints: StoredHttpEndpoint[],
  path: string,
  method: string
): StoredHttpEndpoint | null {
  let best: StoredHttpEndpoint | null = null;
  let bestPrefixLen = -1;

  for (const ep of endpoints) {
    const routes = ep.routes;
    if (routes.length === 0) {
      // match-all endpoint
      if (bestPrefixLen < 0) {
        best = ep;
        bestPrefixLen = 0;
      }
      continue;
    }

    for (const route of routes) {
      const prefix = route.pathPrefix ?? '';
      if (prefix && !path.startsWith(prefix)) continue;
      if (route.methods && route.methods.length > 0) {
        if (!route.methods.includes(method.toUpperCase())) continue;
      }
      const prefixLen = prefix.length;
      if (prefixLen > bestPrefixLen) {
        best = ep;
        bestPrefixLen = prefixLen;
      }
    }
  }

  return best;
}

export function selectRouteRefFromHttpEndpointSet(
  endpoints: StoredHttpEndpoint[],
  path: string,
  method: string
): string | null {
  const endpoint = selectHttpEndpointFromHttpEndpointSet(endpoints, path, method);
  if (!endpoint) {
    return null;
  }
  return endpoint.target.kind === 'service-ref' ? endpoint.target.ref : null;
}

export function parseRoutingValue(raw: string | null | undefined): ParsedRoutingValue {
  if (!raw) {
    return { target: null, rawFormat: 'empty' };
  }

  // JSON envelope (new)
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed === 'string' && parsed) {
      return { target: toSingleDeploymentTarget(parsed), rawFormat: 'json' };
    }
    if (parsed && typeof parsed === 'object') {
      const obj = parsed as Record<string, unknown>;

      const tombstoneUntil = parseEpochMillis(obj.tombstoneUntil);
      const updatedAt = parseEpochMillis(obj.updatedAt);
      const version = typeof obj.version === 'number' && Number.isFinite(obj.version) ? obj.version : undefined;

      if (obj.tombstone === true || (typeof tombstoneUntil === 'number' && tombstoneUntil > 0)) {
        return {
          target: null,
          tombstoneUntil,
          updatedAt,
          version,
          rawFormat: 'json',
        };
      }

      if (isRoutingTarget(obj)) {
        return { target: obj, tombstoneUntil, updatedAt, version, rawFormat: 'json' };
      }

      // Parsed JSON but unknown/unsupported shape: fail-close.
      return { target: null, rawFormat: 'unknown' };
    }

    // Parsed JSON primitive but not supported.
    return { target: null, rawFormat: 'unknown' };
  } catch {
    // fallthrough
  }

  return { target: null, rawFormat: 'unknown' };
}

function buildKVPayload(options: {
  target: RoutingTarget | null;
  updatedAt: number;
  version?: number;
  tombstoneUntil?: number;
}): string {
  if (!options.target) {
    return JSON.stringify({
      tombstone: true,
      tombstoneUntil: options.tombstoneUntil,
      updatedAt: options.updatedAt,
      version: options.version,
    });
  }
  return JSON.stringify({
    ...options.target,
    updatedAt: options.updatedAt,
    version: options.version,
  });
}

function shouldUseKvValue(parsed: ParsedRoutingValue, nowMs: number): boolean {
  if (!parsed.target) return false;
  if (!parsed.updatedAt) return false;
  return nowMs - parsed.updatedAt <= L2_MAX_AGE_MS;
}

function asRoutingFetcher(stub: unknown): RoutingFetcherLike {
  return stub as unknown as RoutingFetcherLike;
}

async function fetchJsonWithTimeout<T>(
  stub: RoutingFetcherLike,
  url: string,
  init: RequestInit,
  timeoutMs: number
): Promise<T> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const requestInit: RequestInit = {
      ...init,
      signal: controller.signal,
    };
    const request = new Request(url, requestInit);
    const res = await stub.fetch(request as unknown as Parameters<RoutingFetcherLike['fetch']>[0]);
    if (!res.ok) {
      throw new Error(`DO returned ${res.status}`);
    }
    return (await res.json()) as T;
  } finally {
    clearTimeout(timeoutId);
  }
}

async function doGetRecord(env: RoutingEnvWithDo, hostname: string, timeoutMs: number): Promise<RoutingRecord | null> {
  const stub = asRoutingFetcher(getRoutingDOStub(env, hostname));
  const data = await fetchJsonWithTimeout<{ record: RoutingRecord | null }>(
    stub,
    'http://internal/routing/get',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ hostname }),
    },
    timeoutMs
  );
  return data.record;
}

async function doPutRecord(env: RoutingEnvWithDo, hostname: string, target: RoutingTarget, updatedAt: number, timeoutMs: number): Promise<void> {
  const stub = asRoutingFetcher(getRoutingDOStub(env, hostname));
  await fetchJsonWithTimeout<{ record: RoutingRecord }>(
    stub,
    'http://internal/routing/put',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ hostname, target, updatedAt }),
    },
    timeoutMs
  );
}

async function doDeleteRecord(env: RoutingEnvWithDo, hostname: string, tombstoneTtlMs: number, updatedAt: number, timeoutMs: number): Promise<void> {
  const stub = asRoutingFetcher(getRoutingDOStub(env, hostname));
  await fetchJsonWithTimeout<{ record: RoutingRecord }>(
    stub,
    'http://internal/routing/delete',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ hostname, tombstoneTtlMs, updatedAt }),
    },
    timeoutMs
  );
}

/**
 * Run a task in the background via waitUntil if available, otherwise await it.
 */
async function runBackground(ctx: PlatformExecutionContext | undefined, task: Promise<unknown>): Promise<void> {
  const waitUntil = ctx?.waitUntil;
  if (typeof waitUntil === 'function') {
    waitUntil.call(ctx, task);
  } else {
    await task;
  }
}

function putL1(hostname: string, value: ResolvedRouting, nowMs: number) {
  if (l1Cache.size >= L1_MAX_ENTRIES) {
    l1Cache.clear();
  }
  l1Cache.set(hostname, { expiresAt: nowMs + L1_TTL_MS, value });
}

function getL1(hostname: string, nowMs: number): ResolvedRouting | null {
  const cached = l1Cache.get(hostname);
  if (!cached) return null;
  if (cached.expiresAt <= nowMs) {
    l1Cache.delete(hostname);
    return null;
  }
  return cached.value;
}

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
    if (l1) return { ...l1, source: 'l1' };
  }

  if (hasRoutingStore(options.env)) {
    const record = await options.env.ROUTING_STORE.getRecord(hostname);
    const tombstone = typeof record?.tombstoneUntil === 'number' && record.tombstoneUntil > nowMs;
    const resolved: ResolvedRouting = {
      target: tombstone ? null : (record?.target ?? null),
      tombstone,
      source: 'store',
      record,
    };
    if (phase >= 3) {
      putL1(hostname, resolved, nowMs);
    }
    return resolved;
  }

  if (!options.env.HOSTNAME_ROUTING) {
    throw new Error('HOSTNAME_ROUTING is not configured');
  }

  const kvRaw = await options.env.HOSTNAME_ROUTING.get(hostname);
  const kv = parseRoutingValue(kvRaw);

  if (phase === 1) {
    const tombstone = typeof kv.tombstoneUntil === 'number' && kv.tombstoneUntil > nowMs;
    return { target: kv.target, tombstone, source: 'kv', kv };
  }

  const envWithDo = hasRoutingDO(options.env) ? options.env : null;
  const timeoutMs = options.timeoutMs ?? DEFAULT_DO_TIMEOUT_MS;

  const maybeResolveFromDo = async (): Promise<ResolvedRouting | null> => {
    if (!envWithDo) return null;
    try {
      const record = await doGetRecord(envWithDo, hostname, timeoutMs);
      if (!record) return { target: null, tombstone: false, source: 'do', kv, record: null };
      const tombstone = typeof record.tombstoneUntil === 'number' && record.tombstoneUntil > nowMs;
      return {
        target: tombstone ? null : record.target,
        tombstone,
        source: 'do',
        kv,
        record,
      };
    } catch (err) {
      logWarn(`${ROUTING_LOG_PREFIX} DO get failed for ${hostname}`, { module: 'services/routing', detail: err });
      return null;
    }
  };

  // Phase 2: KV primary + DO verify (trust DO when available)
  if (phase === 2) {
    const resolved = await maybeResolveFromDo();

    // DO miss: use KV, and opportunistically backfill DO.
    if (resolved && !resolved.record && kv.target && envWithDo) {
      const task = doPutRecord(envWithDo, hostname, kv.target, nowMs, timeoutMs).catch((err) => {
        logWarn(`${ROUTING_LOG_PREFIX} DO backfill put failed for ${hostname}`, { module: 'services/routing', detail: err });
      });
      options.executionCtx?.waitUntil?.(task);
      return { target: kv.target, tombstone: false, source: 'kv', kv, record: null };
    }

    // DO hit: compare and refresh KV cache if mismatched.
    if (resolved?.record) {
      const doTarget = resolved.tombstone ? null : resolved.record.target;
      const mismatch = JSON.stringify(kv.target) !== JSON.stringify(doTarget);
      if (mismatch) {
        logWarn(`${ROUTING_LOG_PREFIX} verify mismatch for ${hostname}`, { module: 'services/routing', detail: {
          kv: kvRaw ? String(kvRaw).slice(0, 200) : null,
          do: resolved.record,
        } });

        // Refresh KV to DO truth (best-effort).
        const payload = buildKVPayload({
          target: doTarget,
          updatedAt: nowMs,
          version: resolved.record.version,
          tombstoneUntil: resolved.record.tombstoneUntil,
        });

        const task = options.env.HOSTNAME_ROUTING.put(hostname, payload).catch((err) => {
          logWarn(`${ROUTING_LOG_PREFIX} KV refresh failed for ${hostname}`, { module: 'services/routing', detail: err });
        });
        options.executionCtx?.waitUntil?.(task);
      }

      if (phase >= 3) {
        putL1(hostname, resolved, nowMs);
      }

      // Trust DO.
      return resolved;
    }

    // No DO available (or error): KV only.
    return { target: kv.target, tombstone: false, source: 'kv', kv };
  }

  // Phase 3/4: caches + DO primary fallback
  if (shouldUseKvValue(kv, nowMs)) {
    const resolved: ResolvedRouting = { target: kv.target, tombstone: false, source: 'kv', kv };
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
      const kvOpts = phase >= 4 ? { expirationTtl: L2_KV_TTL_SECONDS } : undefined;
      const task = options.env.HOSTNAME_ROUTING.put(hostname, payload, kvOpts).catch((err) => {
        logWarn(`${ROUTING_LOG_PREFIX} KV cache refresh failed for ${hostname}`, { module: 'services/routing', detail: err });
      });
      options.executionCtx?.waitUntil?.(task);
    }

    putL1(hostname, resolved, nowMs);
    return resolved;
  }

  // DO unavailable: fall back to KV (even if stale), but log.
  if (kv.target) {
    logWarn(`${ROUTING_LOG_PREFIX} DO unavailable; falling back to KV for ${hostname}`, { module: 'services/routing' });
    const fallback: ResolvedRouting = { target: kv.target, tombstone: false, source: 'kv_fallback', kv };
    putL1(hostname, fallback, nowMs);
    return fallback;
  }

  return { target: null, tombstone: false, source: 'kv', kv };
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

  if (hasRoutingStore(options.env)) {
    await options.env.ROUTING_STORE.putRecord(hostname, options.target, nowMs);
    return;
  }

  if (!options.env.HOSTNAME_ROUTING) {
    throw new Error('HOSTNAME_ROUTING is not configured');
  }

  const kvPayload = buildKVPayload({ target: options.target, updatedAt: nowMs });
  const kvOpts = phase >= 4 ? { expirationTtl: L2_KV_TTL_SECONDS } : undefined;

  if (phase < 3) {
    await options.env.HOSTNAME_ROUTING.put(hostname, kvPayload, kvOpts);
    if (hasRoutingDO(options.env)) {
      const task = doPutRecord(options.env, hostname, options.target, nowMs, timeoutMs).catch((err) => {
        logWarn(`${ROUTING_LOG_PREFIX} DO put failed for ${hostname}`, { module: 'services/routing', detail: err });
      });
      await runBackground(options.executionCtx, task);
    }
    return;
  }

  // Phase 3/4: DO primary (required)
  if (!hasRoutingDO(options.env)) {
    throw new Error('ROUTING_DO is not configured');
  }

  await doPutRecord(options.env, hostname, options.target, nowMs, timeoutMs);

  const kvTask = options.env.HOSTNAME_ROUTING.put(hostname, kvPayload, kvOpts).catch((err) => {
    logWarn(`${ROUTING_LOG_PREFIX} KV put failed for ${hostname}`, { module: 'services/routing', detail: err });
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

  if (hasRoutingStore(options.env)) {
    await options.env.ROUTING_STORE.deleteRecord(hostname, tombstoneTtlMs, nowMs);
    return;
  }

  if (!options.env.HOSTNAME_ROUTING) {
    throw new Error('HOSTNAME_ROUTING is not configured');
  }

  if (phase < 3) {
    await options.env.HOSTNAME_ROUTING.delete(hostname);
    if (hasRoutingDO(options.env)) {
      const task = doDeleteRecord(options.env, hostname, tombstoneTtlMs, nowMs, timeoutMs).catch((err) => {
        logWarn(`${ROUTING_LOG_PREFIX} DO delete failed for ${hostname}`, { module: 'services/routing', detail: err });
      });
      await runBackground(options.executionCtx, task);
    }
    return;
  }

  if (!hasRoutingDO(options.env)) {
    throw new Error('ROUTING_DO is not configured');
  }

  await doDeleteRecord(options.env, hostname, tombstoneTtlMs, nowMs, timeoutMs);

  const tombstoneUntil = nowMs + tombstoneTtlMs;
  const kvPayload = buildKVPayload({ target: null, updatedAt: nowMs, tombstoneUntil });
  const kvTask = options.env.HOSTNAME_ROUTING.put(hostname, kvPayload, { expirationTtl: L2_KV_TTL_SECONDS }).catch(
    (err) => {
      logWarn(`${ROUTING_LOG_PREFIX} KV tombstone put failed for ${hostname}`, { module: 'services/routing', detail: err });
    }
  );
  await runBackground(options.executionCtx, kvTask);
}
