import type { DbEnv } from "../../../shared/types/index.ts";
import { parseServiceResponse } from "../../../shared/utils/service-client.ts";
import { getOrCreateBillingAccount, recordUsage } from "../billing/billing.ts";
import { withTimeout } from "../../../shared/utils/with-timeout.ts";
import { logError, logWarn } from "../../../shared/utils/logger.ts";
import * as jose from "jose";

type RuntimeEnv = DbEnv & {
  RUNTIME_HOST?: { fetch(request: Request): Promise<Response> };
  PLATFORM_PRIVATE_KEY?: string;
};

const DEFAULT_TIMEOUT_MS = 3600000;
const RUNTIME_SERVICE_JWT_AUDIENCE = "takos-runtime";
const RUNTIME_SERVICE_JWT_ISSUER = "takos-control";
const RUNTIME_SERVICE_JWT_TTL_SECONDS = 5 * 60;

type RuntimeServiceJwtPrivateKey = Awaited<ReturnType<typeof jose.importPKCS8>>;

const runtimeJwtPrivateKeyCache = new Map<
  string,
  Promise<RuntimeServiceJwtPrivateKey>
>();

function anySignal(signals: AbortSignal[]): AbortSignal {
  const controller = new AbortController();
  for (const signal of signals) {
    if (signal.aborted) {
      controller.abort(signal.reason);
      return controller.signal;
    }
    signal.addEventListener("abort", () => controller.abort(signal.reason), {
      once: true,
    });
  }
  return controller.signal;
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
  if (cached) return cached;
  const imported = jose.importPKCS8(privateKeyPem, "RS256");
  runtimeJwtPrivateKeyCache.set(privateKeyPem, imported);
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
): Promise<string | null> {
  const privateKeyPem = getRuntimeServiceJwtPrivateKeyPem(env);
  if (!privateKeyPem) return null;

  const privateKey = await importRuntimeServiceJwtPrivateKey(privateKeyPem);
  const now = Math.floor(Date.now() / 1000);
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
  } = {},
) {
  const { method = "POST", body, timeoutMs = DEFAULT_TIMEOUT_MS, signal } =
    options;
  const headers: Record<string, string> = {
    "X-Takos-Internal-Marker": "1",
  };

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

  const runtimeServiceJwt = await buildRuntimeServiceJwt(env, body);
  if (runtimeServiceJwt) {
    headers.Authorization = `Bearer ${runtimeServiceJwt}`;
  }

  const bodyStr = body ? JSON.stringify(body) : undefined;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  const startMs = Date.now();
  const requestSignal = signal
    ? anySignal([signal, controller.signal])
    : controller.signal;

  try {
    const response = await env.RUNTIME_HOST.fetch(
      new Request(`https://runtime-host${endpoint}`, {
        method,
        headers,
        body: bodyStr,
        signal: requestSignal,
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
      const { GatewayTimeoutError } = await import("takos-common/errors");
      throw new GatewayTimeoutError(
        `takos-runtime request timed out after ${
          Math.round(timeoutMs / 1000)
        }s`,
      );
    }
    throw err;
  } finally {
    clearTimeout(timeoutId);
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
    const account = await getOrCreateBillingAccount(
      env.DB,
      workspace.ownerAccountId || spaceId,
    );
    await recordUsage(env.DB, {
      accountId: account.id,
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
