import type {
  DurableObjectState,
  ExportedHandler,
} from "@cloudflare/workers-types";

/**
 * takos-runtime-host Worker
 *
 * Hosts TakosRuntimeContainer as a Cloudflare Container (Durable Object sidecar).
 * Other workers call this via RUNTIME_HOST service binding; requests are forwarded
 * transparently to the Node.js Express server running inside the container.
 *
 * Container → host communication uses DO-local random tokens (same pattern as
 * executor). The container calls /forward/* endpoints on this worker,
 * which verifies the token via DO RPC and proxies to takos via service binding.
 */

import { HostContainerRuntime } from "./container-runtime.ts";
import { generateProxyToken } from "./executor-proxy-config.ts";

import { constantTimeEqual } from "../../shared/utils/hash.ts";
import {
  createEnvGuard,
  validateRuntimeHostEnv,
} from "../../shared/utils/validate-env.ts";
import { logError, logWarn } from "../../shared/utils/logger.ts";
import {
  errorJsonResponse,
  jsonResponse,
} from "../../shared/utils/http-response.ts";

interface RuntimeContainerStub {
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
  generateSessionProxyToken(
    sessionId: string,
    spaceId: string,
  ): Promise<string>;
  verifyProxyToken(token: string): Promise<RuntimeProxyTokenInfo | null>;
  revokeSessionProxyTokens?(sessionId: string): Promise<number>;
}

interface ContainerNamespace {
  getByName(name: string): RuntimeContainerStub;
}

export const RUNTIME_PROXY_TOKEN_HEADER = "X-Takos-Proxy-Token";
export const RUNTIME_PROXY_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;

interface Env {
  RUNTIME_CONTAINER: ContainerNamespace;
  ADMIN_DOMAIN: string;
  PROXY_BASE_URL: string;
  TAKOS_WEB?: { fetch(request: Request): Promise<Response> };
  PLATFORM_PUBLIC_KEY?: string;
  JWT_PUBLIC_KEY?: string;
}

function normalizePublicKeyForCompare(value: string | undefined): string {
  return value?.replace(/\\n/g, "\n").trim() ?? "";
}

function resolveRuntimeJwtPublicKey(
  env: Pick<Env, "JWT_PUBLIC_KEY" | "PLATFORM_PUBLIC_KEY">,
): string | undefined {
  const jwtPublicKey = normalizePublicKeyForCompare(env.JWT_PUBLIC_KEY);
  const platformPublicKey = normalizePublicKeyForCompare(
    env.PLATFORM_PUBLIC_KEY,
  );

  if (jwtPublicKey && platformPublicKey && jwtPublicKey !== platformPublicKey) {
    throw new Error(
      "JWT_PUBLIC_KEY must match PLATFORM_PUBLIC_KEY because runtime-service JWTs are signed with PLATFORM_PRIVATE_KEY",
    );
  }

  if (jwtPublicKey) return env.JWT_PUBLIC_KEY;
  if (platformPublicKey) return env.PLATFORM_PUBLIC_KEY;
  return undefined;
}

export function buildRuntimeContainerEnv(
  env: Pick<
    Env,
    "ADMIN_DOMAIN" | "JWT_PUBLIC_KEY" | "PLATFORM_PUBLIC_KEY" | "PROXY_BASE_URL"
  >,
): Record<string, string> {
  const containerEnv: Record<string, string> = {
    TAKOS_API_URL: `https://${env.ADMIN_DOMAIN}`,
  };

  if (env.PROXY_BASE_URL) {
    containerEnv.PROXY_BASE_URL = env.PROXY_BASE_URL;
  }

  const runtimeJwtPublicKey = resolveRuntimeJwtPublicKey(env);
  if (runtimeJwtPublicKey) {
    containerEnv.JWT_PUBLIC_KEY = runtimeJwtPublicKey;
  }

  return containerEnv;
}

/** Token metadata stored alongside each random proxy token. */
export interface RuntimeProxyTokenInfo {
  sessionId: string;
  spaceId: string;
}

type RuntimeProxyTokenRecord = RuntimeProxyTokenInfo & {
  createdAt: number;
  expiresAt: number;
};

function readFiniteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function normalizeRuntimeProxyTokenRecord(
  value: unknown,
  now: number,
): RuntimeProxyTokenRecord | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  if (
    typeof record.sessionId !== "string" ||
    typeof record.spaceId !== "string"
  ) {
    return null;
  }
  const createdAt = readFiniteNumber(record.createdAt) ?? now;
  const expiresAt = readFiniteNumber(record.expiresAt) ??
    createdAt + RUNTIME_PROXY_TOKEN_TTL_MS;
  return {
    sessionId: record.sessionId,
    spaceId: record.spaceId,
    createdAt,
    expiresAt,
  };
}

function publicRuntimeProxyTokenInfo(
  record: RuntimeProxyTokenRecord,
): RuntimeProxyTokenInfo {
  return {
    sessionId: record.sessionId,
    spaceId: record.spaceId,
  };
}

/**
 * Durable Object that manages the takos-runtime container lifecycle.
 * The Container base class automatically starts the container image on first
 * request and routes fetch() calls to the container process on defaultPort.
 */
export class TakosRuntimeContainer extends HostContainerRuntime<Env> {
  defaultPort = 8080;
  sleepAfter = "10m";
  pingEndpoint = "container/health";

  private cachedTokens: Map<string, RuntimeProxyTokenRecord> | null = null;

  constructor(ctx: DurableObjectState<Record<string, never>>, env: Env) {
    super(ctx, env);
    this.envVars = buildRuntimeContainerEnv(env);
  }

  /** Generate a proxy token for a session and persist it in DO storage. */
  async generateSessionProxyToken(
    sessionId: string,
    spaceId: string,
  ): Promise<string> {
    const token = generateProxyToken();
    const now = Date.now();
    const info: RuntimeProxyTokenRecord = {
      sessionId,
      spaceId,
      createdAt: now,
      expiresAt: now + RUNTIME_PROXY_TOKEN_TTL_MS,
    };

    await this.ensureProxyTokensLoaded(now);
    this.cleanupExpiredProxyTokens(now);

    this.cachedTokens!.set(token, info);
    await this.persistProxyTokens();
    return token;
  }

  /** RPC method: called by the worker fetch handler to verify proxy tokens. */
  async verifyProxyToken(token: string): Promise<RuntimeProxyTokenInfo | null> {
    await this.ensureProxyTokensLoaded(Date.now());
    if (!this.cachedTokens) return null;

    for (const [storedToken, info] of this.cachedTokens) {
      if (!constantTimeEqual(token, storedToken)) continue;
      if (info.expiresAt <= Date.now()) {
        this.cachedTokens.delete(storedToken);
        await this.persistProxyTokens();
        return null;
      }
      return publicRuntimeProxyTokenInfo(info);
    }
    return null;
  }

  async revokeSessionProxyTokens(sessionId: string): Promise<number> {
    await this.ensureProxyTokensLoaded(Date.now());
    if (!this.cachedTokens) return 0;

    let revoked = 0;
    for (const [token, info] of this.cachedTokens) {
      if (info.sessionId === sessionId) {
        this.cachedTokens.delete(token);
        revoked++;
      }
    }
    if (revoked > 0) {
      await this.persistProxyTokens();
    }
    return revoked;
  }

  private async ensureProxyTokensLoaded(now: number): Promise<void> {
    if (this.cachedTokens) return;
    const stored = await this.ctx.storage.get<Record<string, unknown>>(
      "proxyTokens",
    );
    if (!stored) {
      this.cachedTokens = new Map();
      return;
    }
    const tokens = new Map<string, RuntimeProxyTokenRecord>();
    for (const [token, value] of Object.entries(stored)) {
      const record = normalizeRuntimeProxyTokenRecord(value, now);
      if (record) tokens.set(token, record);
    }
    this.cachedTokens = tokens;
  }

  private cleanupExpiredProxyTokens(now: number): void {
    if (!this.cachedTokens) return;
    for (const [token, info] of this.cachedTokens) {
      if (info.expiresAt <= now) {
        this.cachedTokens.delete(token);
      }
    }
  }

  private async persistProxyTokens(): Promise<void> {
    await this.ctx.storage.put(
      "proxyTokens",
      Object.fromEntries(this.cachedTokens ?? new Map()),
    );
  }
}

function buildProxyTokenHeader(token: string): Record<string, string> {
  return { [RUNTIME_PROXY_TOKEN_HEADER]: token };
}

export async function buildRuntimeForwardRequest(
  request: Request,
  _env: Env,
  stub: RuntimeContainerStub,
): Promise<Request> {
  const url = new URL(request.url);
  const bodyText = request.method === "GET" || request.method === "HEAD"
    ? null
    : await request.text();
  const headers = new Headers(request.headers);
  headers.delete(RUNTIME_PROXY_TOKEN_HEADER);

  // For /sessions POST, generate a proxy token and inject it
  if (url.pathname === "/sessions" && request.method === "POST" && bodyText) {
    try {
      const parsed: unknown = JSON.parse(bodyText);
      if (typeof parsed === "object" && parsed !== null) {
        const body = parsed as Record<string, unknown>;
        if (
          typeof body.session_id === "string" &&
          typeof body.space_id === "string"
        ) {
          const token = await stub.generateSessionProxyToken(
            body.session_id,
            body.space_id,
          );
          const tokenHeaders = buildProxyTokenHeader(token);
          for (const [key, value] of Object.entries(tokenHeaders)) {
            headers.set(key, value);
          }
        }
      }
    } catch (err) {
      logWarn("Failed to parse /sessions body", {
        module: "runtime-host",
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return new Request(request.url, {
    method: request.method,
    headers,
    body: bodyText,
  });
}

async function readDestroySessionId(request: {
  url: string;
  method: string;
  json(): Promise<unknown>;
}): Promise<string | null> {
  const url = new URL(request.url);
  if (url.pathname !== "/session/destroy" || request.method !== "POST") {
    return null;
  }
  try {
    const parsed: unknown = await request.json();
    if (typeof parsed === "object" && parsed !== null) {
      const sessionId = (parsed as Record<string, unknown>).session_id;
      return typeof sessionId === "string" && sessionId ? sessionId : null;
    }
  } catch (err) {
    logWarn("Failed to parse /session/destroy body", {
      module: "runtime-host",
      error: err instanceof Error ? err.message : String(err),
    });
  }
  return null;
}

async function revokeRuntimeTokenAfterDestroy(
  response: Response,
  stub: RuntimeContainerStub,
  sessionId: string | null,
): Promise<void> {
  if (!response.ok || !sessionId || !stub.revokeSessionProxyTokens) return;
  try {
    await stub.revokeSessionProxyTokens(sessionId);
  } catch (error) {
    logError("Runtime proxy token revoke failed after session destroy", error, {
      module: "runtime-host",
    });
  }
}

function unauthorized(): Response {
  return errorJsonResponse("Unauthorized", 401);
}

// Cached environment validation guard.
const envGuard = createEnvGuard(validateRuntimeHostEnv);

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    // Validate environment on first request (cached).
    const envError = envGuard(env);
    if (envError) {
      return errorJsonResponse("Configuration Error", 503, {
        message: "Runtime host is misconfigured. Please contact administrator.",
      });
    }

    const url = new URL(request.url);
    const path = url.pathname;

    if (path === "/health" && request.method === "GET") {
      return jsonResponse({ status: "ok", service: "takos-runtime-host" });
    }

    // /forward/* — proxy endpoints called by the runtime container
    if (path.startsWith("/forward/")) {
      const authHeader = request.headers.get("Authorization");
      const token = authHeader?.startsWith("Bearer ")
        ? authHeader.slice(7).trim() || null
        : null;
      if (!token) return unauthorized();

      const stub = env.RUNTIME_CONTAINER.getByName("singleton");

      // Verify container proxy tokens via DO RPC.
      const tokenInfo = await stub.verifyProxyToken(token);
      if (!tokenInfo) return unauthorized();

      if (!env.TAKOS_WEB) {
        logError("TAKOS_WEB service binding not configured", undefined, {
          module: "runtime-host",
        });
        return errorJsonResponse("Internal configuration error", 500);
      }

      // /forward/cli-proxy/* — CLI proxy requests from the container
      if (path.startsWith("/forward/cli-proxy/")) {
        const sessionId = request.headers.get("X-Takos-Session-Id");
        if (!sessionId) return unauthorized();
        if (tokenInfo.sessionId !== sessionId) return unauthorized();

        const apiPath = path.replace("/forward/cli-proxy", "");
        const search = url.search;
        return env.TAKOS_WEB.fetch(
          new Request(`https://takos${apiPath}${search}`, {
            method: request.method,
            headers: {
              // X-Takos-Internal-Marker: sentinel that tells the edge auth
              // middleware (`server/middleware/auth.ts`) this call originated
              // from the runtime-host /forward/* proxy. Distinct from
              // X-Takos-Internal, which is a shared secret consumed only by
              // `runtime/executor-proxy-api.ts` with a constant-time compare.
              // See Round 11 MEDIUM #11 and docs/architecture/container-hosts.md.
              "X-Takos-Internal-Marker": "1",
              "X-Takos-Session-Id": sessionId,
              "X-Takos-Space-Id": tokenInfo.spaceId,
              "Content-Type": request.headers.get("Content-Type") ||
                "application/json",
            },
            body: request.body,
          }),
        );
      }

      // /forward/heartbeat/:sessionId — heartbeat from the container
      if (path.startsWith("/forward/heartbeat/")) {
        const sessionId = path.replace("/forward/heartbeat/", "");
        if (!sessionId) return unauthorized();
        if (tokenInfo.sessionId !== sessionId) return unauthorized();

        return env.TAKOS_WEB.fetch(
          new Request(`https://takos/api/sessions/${sessionId}/heartbeat`, {
            method: "POST",
            headers: {
              // See note above on /forward/cli-proxy/*.
              "X-Takos-Internal-Marker": "1",
              "X-Takos-Session-Id": sessionId,
              "X-Takos-Space-Id": tokenInfo.spaceId,
              "Content-Type": "application/json",
            },
          }),
        );
      }

      return errorJsonResponse("Not found", 404);
    }

    // Route all other requests to the singleton runtime container instance.
    const stub = env.RUNTIME_CONTAINER.getByName("singleton");
    try {
      const forwardedRequest = await buildRuntimeForwardRequest(
        request,
        env,
        stub,
      );
      const destroySessionId = await readDestroySessionId(
        forwardedRequest.clone(),
      );
      const response = await stub.fetch(forwardedRequest);
      await revokeRuntimeTokenAfterDestroy(response, stub, destroySessionId);
      return response;
    } catch (err) {
      logError("container fetch failed", err, { module: "runtime-host" });
      const message = err instanceof Error ? err.message : String(err);
      return new Response(`Failed to start container: ${message}`, {
        status: 500,
      });
    }
  },
} satisfies ExportedHandler<Env>;
