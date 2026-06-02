import type { DbEnv } from "../../../shared/types/index.ts";
import { parseServiceResponse } from "../../../shared/utils/service-client.ts";
import { recordAppUsage } from "../app-usage/usage-recorder.ts";
import { withTimeout } from "../../../shared/utils/with-timeout.ts";
import { logError, logWarn } from "../../../shared/utils/logger.ts";
import { type TtlSeconds, ttlSeconds } from "@takos/worker-platform-utils/ttl";
import { type Clock, systemClock } from "@takos/worker-platform-utils/clock";
import * as jose from "jose";

type RuntimeEnv = DbEnv & {
  RUNTIME_HOST?: { fetch(request: Request): Promise<Response> };
  PLATFORM_PRIVATE_KEY?: string;
};

const DEFAULT_TIMEOUT_MS = 3600000;
const RUNTIME_SERVICE_JWT_AUDIENCE = "takos-runtime";
const RUNTIME_SERVICE_JWT_ISSUER = "takos-control";
const RUNTIME_SERVICE_JWT_TTL_SECONDS: TtlSeconds = ttlSeconds(5 * 60);

type RuntimeServiceJwtPrivateKey = Awaited<ReturnType<typeof jose.importPKCS8>>;

/**
 * LRU cap for {@link runtimeJwtPrivateKeyCache}.
 *
 * The cache is keyed by raw PEM string. PEM rotation is rare, so a small cap
 * is sufficient; the bound exists to prevent unbounded growth if a caller
 * (or a misconfigured rotation cycle) feeds in an unbounded sequence of
 * distinct PEMs.
 */
const RUNTIME_JWT_PRIVATE_KEY_CACHE_MAX = 32;

/**
 * Cache of imported JWT signing keys, keyed by PEM string. Uses Map insertion
 * order plus delete-and-reinsert on access to approximate LRU semantics, and
 * evicts the least-recently-used entry when the cap is reached.
 */
const runtimeJwtPrivateKeyCache = new Map<
  string,
  Promise<RuntimeServiceJwtPrivateKey>
>();

/** Test-only hook. Resets the cache so eviction behaviour can be exercised. */
export function __resetRuntimeJwtPrivateKeyCacheForTesting(): void {
  runtimeJwtPrivateKeyCache.clear();
}

/** Test-only hook. Returns the current cache size. */
export function __runtimeJwtPrivateKeyCacheSizeForTesting(): number {
  return runtimeJwtPrivateKeyCache.size;
}

function normalizePem(value: string | undefined): string {
  const normalized = value?.replace(/\\n/g, "\n").trim() ?? "";
  if (!normalized || normalized.includes("...")) return "";
  return normalized.includes("-----BEGIN") ? normalized : "";
}

function getRuntimeServiceJwtPrivateKeyPem(env: RuntimeEnv): string {
  return normalizePem(env.PLATFORM_PRIVATE_KEY);
}

function importRuntimeServiceJwtPrivateKey(
  privateKeyPem: string,
): Promise<RuntimeServiceJwtPrivateKey> {
  const cached = runtimeJwtPrivateKeyCache.get(privateKeyPem);
  if (cached) {
    // Promote to most-recently-used by re-inserting at the tail of the Map.
    runtimeJwtPrivateKeyCache.delete(privateKeyPem);
    runtimeJwtPrivateKeyCache.set(privateKeyPem, cached);
    return cached;
  }
  const imported = jose.importPKCS8(privateKeyPem, "RS256");
  runtimeJwtPrivateKeyCache.set(privateKeyPem, imported);
  // Evict least-recently-used entries while above the cap. Map iteration
  // order is insertion order, so the first key is the LRU entry.
  while (runtimeJwtPrivateKeyCache.size > RUNTIME_JWT_PRIVATE_KEY_CACHE_MAX) {
    const oldest = runtimeJwtPrivateKeyCache.keys().next().value;
    if (oldest === undefined) break;
    runtimeJwtPrivateKeyCache.delete(oldest);
  }
  return imported;
}

function readStringField(
  body: Record<string, unknown> | undefined,
  ...fieldNames: string[]
): string | undefined {
  for (const fieldName of fieldNames) {
    const value = body?.[fieldName];
    if (typeof value === "string" && value.length > 0) return value;
  }
  return undefined;
}

async function buildRuntimeServiceJwt(
  env: RuntimeEnv,
  body: Record<string, unknown> | undefined,
  clock: Clock = systemClock,
): Promise<string | null> {
  const privateKeyPem = getRuntimeServiceJwtPrivateKeyPem(env);
  if (!privateKeyPem) return null;

  const privateKey = await importRuntimeServiceJwtPrivateKey(privateKeyPem);
  const now = Math.floor(clock.now() / 1000);
  const claims: Record<string, unknown> = {};
  const scopeSpaceId = readStringField(body, "space_id", "spaceId");
  const sessionId = readStringField(body, "session_id", "sessionId");
  if (scopeSpaceId) claims.scope_space_id = scopeSpaceId;
  if (sessionId) claims.session_id = sessionId;

  return await new jose.SignJWT(claims)
    .setProtectedHeader({ alg: "RS256", typ: "JWT" })
    .setIssuer(RUNTIME_SERVICE_JWT_ISSUER)
    .setAudience(RUNTIME_SERVICE_JWT_AUDIENCE)
    .setSubject(
      readStringField(body, "user_id", "userId", "account_id", "accountId") ??
        RUNTIME_SERVICE_JWT_ISSUER,
    )
    .setIssuedAt(now)
    .setExpirationTime(now + RUNTIME_SERVICE_JWT_TTL_SECONDS)
    .setJti(crypto.randomUUID())
    .sign(privateKey);
}

export async function callRuntimeRequest(
  env: RuntimeEnv,
  endpoint: string,
  options: {
    method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
    body?: Record<string, unknown>;
    timeoutMs?: number;
    signal?: AbortSignal;
    clock?: Clock;
  } = {},
) {
  const {
    method = "POST",
    body,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    signal,
    clock = systemClock,
  } = options;
  // The runtime-host is reached only through the RUNTIME_HOST service binding
  // (the binding is the trust boundary), so no internal marker is needed.
  const headers: Record<string, string> = {};

  if (body) {
    headers["Content-Type"] = "application/json";
  }

  // Pass space_id as a header so runtime-host can use it for scoping
  const spaceId = readStringField(body, "space_id", "spaceId");
  if (spaceId) {
    headers["X-Takos-Space-Id"] = spaceId;
  }

  if (!env.RUNTIME_HOST) {
    throw new Error("RUNTIME_HOST binding is required");
  }

  const runtimeServiceJwt = await buildRuntimeServiceJwt(env, body, clock);
  if (runtimeServiceJwt) {
    headers.Authorization = `Bearer ${runtimeServiceJwt}`;
  }

  const bodyStr = body ? JSON.stringify(body) : undefined;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  const startMs = Date.now();
  const onExternalAbort = () => controller.abort(signal?.reason);
  if (signal?.aborted) {
    onExternalAbort();
  } else {
    signal?.addEventListener("abort", onExternalAbort, { once: true });
  }

  try {
    const response = await env.RUNTIME_HOST.fetch(
      new Request(`https://runtime-host${endpoint}`, {
        method,
        headers,
        body: bodyStr,
        signal: controller.signal,
      }),
    );

    if (spaceId && endpoint.includes("/exec")) {
      const elapsedSeconds = Math.ceil((Date.now() - startMs) / 1000);
      withTimeout(
        recordRuntimeUsage(env, spaceId, elapsedSeconds, endpoint),
        10_000,
        "recordRuntimeUsage timed out",
      ).catch((err) => {
        logWarn("[RUNTIME] recordRuntimeUsage failed (non-fatal)", {
          action: "recordRuntimeUsage",
          spaceId,
          elapsedSeconds: String(elapsedSeconds),
          endpoint,
          errorValue: err instanceof Error ? err.message : String(err),
        });
      });
    }

    return response;
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      const { GatewayTimeoutError } = await import(
        "@takos/worker-platform-utils/errors"
      );
      throw new GatewayTimeoutError(
        `takos-runtime request timed out after ${
          Math.round(timeoutMs / 1000)
        }s`,
      );
    }
    throw err;
  } finally {
    clearTimeout(timeoutId);
    signal?.removeEventListener("abort", onExternalAbort);
  }
}

/**
 * Record exec_seconds usage for billing (non-blocking, fire-and-forget).
 * Retries once on transient failure.
 */
async function recordRuntimeUsage(
  env: RuntimeEnv,
  spaceId: string,
  seconds: number,
  endpoint: string,
): Promise<void> {
  const doRecord = async () => {
    const { getDb, accounts } = await import("../../../infra/db/index.ts");
    const { eq } = await import("drizzle-orm");
    const drizzle = getDb(env.DB);
    const workspace = await drizzle.select({
      ownerAccountId: accounts.ownerAccountId,
    }).from(accounts).where(eq(accounts.id, spaceId)).get();
    if (!workspace) return;
    await recordAppUsage(env.DB, {
      ownerAccountId: workspace.ownerAccountId || spaceId,
      spaceId,
      meterType: "exec_seconds",
      units: seconds,
      referenceType: "runtime_exec",
      metadata: { endpoint },
    });
  };

  try {
    await doRecord();
  } catch (firstErr) {
    logWarn("[RUNTIME] recordRuntimeUsage first attempt failed, retrying", {
      action: "recordRuntimeUsage",
      spaceId,
      endpoint,
      errorValue: firstErr instanceof Error
        ? firstErr.message
        : String(firstErr),
    });
    // Retry once for transient failures
    try {
      await doRecord();
    } catch (retryErr) {
      logError("[RUNTIME] recordRuntimeUsage retry also failed", retryErr, {
        action: "recordRuntimeUsage",
        spaceId,
        endpoint,
      });
      throw retryErr;
    }
  }
}

export async function callRuntime(
  env: RuntimeEnv,
  endpoint: string,
  body: Record<string, unknown>,
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
) {
  return callRuntimeRequest(env, endpoint, { method: "POST", body, timeoutMs });
}

/**
 * Call runtime and parse the JSON response with type safety.
 * Throws ServiceCallError on non-2xx responses.
 */
export async function callRuntimeJson<T>(
  env: RuntimeEnv,
  endpoint: string,
  body: Record<string, unknown>,
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<T> {
  const res = await callRuntime(env, endpoint, body, timeoutMs);
  return parseServiceResponse<T>(res, "takos-runtime");
}
