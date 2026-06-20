/**
 * Routing Cache
 *
 * L1 (isolate-local Map) and L2 (kv store) cache management,
 * kv store payload building, and Durable Object interaction helpers.
 */

import { getRoutingDOStub } from "./sharding.ts";
import type {
  ParsedRoutingValue,
  ResolvedRouting,
  RoutingBindings,
  RoutingRecord,
  RoutingTarget,
} from "./routing-models.ts";
import type { PlatformExecutionContext } from "../../../shared/types/bindings.ts";
import {
  type TtlMs,
  ttlMs,
  type TtlSeconds,
  ttlSeconds,
} from "@takos/worker-platform-utils/ttl";
export const ROUTING_LOG_PREFIX = "[Routing]";

const L1_TTL: TtlMs = ttlMs(10_000); // isolate local cache
const L1_MAX_ENTRIES = 2048;

// kv store "freshness" is enforced in application logic (not relying on kv store propagation).
const L2_MAX_AGE: TtlMs = ttlMs(90_000);

// Phase 4: kv store is pure cache (short TTL)
export const L2_KV_TTL: TtlSeconds = ttlSeconds(120);

export const DEFAULT_DO_TIMEOUT: TtlMs = ttlMs(1_000);

export const DEFAULT_TOMBSTONE_TTL: TtlMs = ttlMs(2 * 60_000); // 2 minutes

type L1Entry = { expiresAt: number; value: ResolvedRouting };
const l1Cache = new Map<string, L1Entry>();

type RoutingNamespace = NonNullable<RoutingBindings["ROUTING_DO"]>;
export type RoutingEnvWithDo = RoutingBindings & {
  ROUTING_DO: RoutingNamespace;
};
type RoutingFetcherLike = {
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
};

export function hasRoutingDO(env: RoutingBindings): env is RoutingEnvWithDo {
  return Boolean(env.ROUTING_DO);
}

export function hasRoutingStore(
  env: RoutingBindings,
): env is RoutingBindings & {
  ROUTING_STORE: NonNullable<RoutingBindings["ROUTING_STORE"]>;
} {
  return Boolean(env.ROUTING_STORE);
}

export function putL1(
  hostname: string,
  value: ResolvedRouting,
  nowMs: number,
): void {
  if (l1Cache.size >= L1_MAX_ENTRIES) {
    l1Cache.clear();
  }
  l1Cache.set(hostname, { expiresAt: nowMs + L1_TTL, value });
}

export function deleteL1(hostname: string): void {
  l1Cache.delete(hostname);
}

export function clearL1(): void {
  l1Cache.clear();
}

export function getL1(hostname: string, nowMs: number): ResolvedRouting | null {
  const cached = l1Cache.get(hostname);
  if (!cached) return null;
  if (cached.expiresAt <= nowMs) {
    l1Cache.delete(hostname);
    return null;
  }
  return cached.value;
}

export function buildKVPayload(options: {
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

export function shouldUseKvValue(
  parsed: ParsedRoutingValue,
  nowMs: number,
): boolean {
  if (!parsed.target) return false;
  if (!parsed.updatedAt) return false;
  return nowMs - parsed.updatedAt <= L2_MAX_AGE;
}

function asRoutingFetcher(stub: unknown): RoutingFetcherLike {
  if (
    typeof stub !== "object" || stub === null ||
    typeof Reflect.get(stub, "fetch") !== "function"
  ) {
    throw new TypeError("Routing Durable Object stub does not expose fetch()");
  }
  const fetcher = stub as RoutingFetcherLike;
  return {
    fetch(input, init) {
      return fetcher.fetch(input, init);
    },
  };
}

async function fetchJsonWithTimeout<T>(
  stub: RoutingFetcherLike,
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<T> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const requestInit: RequestInit = {
      ...init,
      signal: controller.signal,
    };
    const request = new Request(url, requestInit);
    const res = await stub.fetch(request);
    if (!res.ok) {
      throw new Error(`DO returned ${res.status}`);
    }
    return (await res.json()) as T;
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function doGetRecord(
  env: RoutingEnvWithDo,
  hostname: string,
  timeoutMs: number,
): Promise<RoutingRecord | null> {
  const stub = asRoutingFetcher(getRoutingDOStub(env, hostname));
  const data = await fetchJsonWithTimeout<{ record: RoutingRecord | null }>(
    stub,
    "http://internal/routing/get",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ hostname }),
    },
    timeoutMs,
  );
  return data.record;
}

export async function doPutRecord(
  env: RoutingEnvWithDo,
  hostname: string,
  target: RoutingTarget,
  updatedAt: number,
  timeoutMs: number,
): Promise<void> {
  const stub = asRoutingFetcher(getRoutingDOStub(env, hostname));
  await fetchJsonWithTimeout<{ record: RoutingRecord }>(
    stub,
    "http://internal/routing/put",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ hostname, target, updatedAt }),
    },
    timeoutMs,
  );
}

export async function doDeleteRecord(
  env: RoutingEnvWithDo,
  hostname: string,
  tombstoneTtlMs: number,
  updatedAt: number,
  timeoutMs: number,
): Promise<void> {
  const stub = asRoutingFetcher(getRoutingDOStub(env, hostname));
  await fetchJsonWithTimeout<{ record: RoutingRecord }>(
    stub,
    "http://internal/routing/delete",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ hostname, tombstoneTtlMs, updatedAt }),
    },
    timeoutMs,
  );
}

/**
 * Run a task in the background via waitUntil if available, otherwise await it.
 */
export async function runBackground(
  ctx: PlatformExecutionContext | undefined,
  task: Promise<unknown>,
): Promise<void> {
  const waitUntil = ctx?.waitUntil;
  if (typeof waitUntil === "function") {
    waitUntil.call(ctx, task);
  } else {
    await task;
  }
}
