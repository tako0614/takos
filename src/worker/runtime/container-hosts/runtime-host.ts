import type {
  DurableObjectStateBinding,
  PlatformHandler,
} from "../../shared/types/bindings.ts";

/**
 * Runtime container host handler
 *
 * Hosts TakosRuntimeContainer as a Cloudflare Container (Durable Object sidecar).
 * The unified takos Worker calls this in-process when no RUNTIME_HOST service
 * binding is configured. Requests are forwarded transparently to the Node.js
 * Express server running inside the container.
 *
 * Container → host communication uses DO-local random tokens (same pattern as
 * executor): on runtime session creation the host mints a per-session proxy
 * token (RUNTIME_PROXY_TOKEN_HEADER) and the container presents it back when it
 * calls the host. There is no public /forward/* re-entry into the worker — that
 * forgeable-marker proxy path was removed; the DO stub / service binding is the
 * trust boundary.
 */

import { HostContainerRuntime } from "./container-runtime.ts";
import { generateProxyToken } from "./executor-proxy-config.ts";

import { constantTimeEqualsString } from "takosumi-contract/internal-crypto";
import {
  createEnvGuard,
  validateRuntimeHostEnv,
} from "../../shared/utils/validate-env.ts";
import { logError, logWarn } from "../../shared/utils/logger.ts";
import {
  errorJsonResponse,
  jsonResponse,
} from "../../shared/utils/http-response.ts";
import { type TtlMs, ttlMs } from "@takos/worker-platform-utils/ttl";

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
export const RUNTIME_PROXY_TOKEN_TTL_MS: TtlMs = ttlMs(24 * 60 * 60 * 1000);

export interface RuntimeHostEnv {
  RUNTIME_CONTAINER: ContainerNamespace;
  ADMIN_DOMAIN: string;
  PROXY_BASE_URL: string;
  PLATFORM_PUBLIC_KEY?: string;
  /**
   * Optional worker-mediated egress proxy URL handed to the workflow/actions
   * container. SECURITY INVARIANT: when set, this MUST point at the per-run,
   * SSRF-gated egress endpoint (the value that proxies through
   * `runtime/worker/egress.ts` — private-IP / port / protocol / redirect /
   * credential blocking + per-run rate limiting), NOT the open internet and NOT
   * a direct/transparent proxy. `buildRuntimeContainerEnv` will only ever emit
   * this as the container's egress proxy; it never derives an egress proxy from
   * `PROXY_BASE_URL` (which is the control back-channel, not an outbound gate).
   *
   * This is the worker-side wiring point for the tracked "gate
   * workflow-container egress deny-by-default" hardening
   * (docs/architecture/internal-trust-boundaries.md §2). Until the infra layer
   * (a) routes this URL through the SSRF guard and (b) applies a Cloudflare
   * Container network policy that denies container-direct outbound, the
   * container can still reach the internet directly — see the module note below.
   */
  TAKOS_EGRESS_PROXY_URL?: string;
}

// Local shorthand used by this module's internal helpers.
type Env = RuntimeHostEnv;

/**
 * Env var name the workflow/actions container is expected to honor for its
 * outbound HTTP egress proxy. Centralized here so the only value ever assigned
 * to it is the gated egress URL (never an open/direct proxy).
 */
export const CONTAINER_EGRESS_PROXY_ENV = "TAKOS_EGRESS_PROXY_URL";

export function buildRuntimeContainerEnv(
  env: Pick<
    Env,
    | "ADMIN_DOMAIN"
    | "PLATFORM_PUBLIC_KEY"
    | "PROXY_BASE_URL"
    | "TAKOS_EGRESS_PROXY_URL"
  >,
): Record<string, string> {
  const containerEnv: Record<string, string> = {
    TAKOS_API_URL: `https://${env.ADMIN_DOMAIN}`,
  };

  if (env.PROXY_BASE_URL) {
    containerEnv.PROXY_BASE_URL = env.PROXY_BASE_URL;
  }

  if (env.PLATFORM_PUBLIC_KEY) {
    containerEnv.JWT_PUBLIC_KEY = env.PLATFORM_PUBLIC_KEY;
  }

  // Egress proxy: only ever the gated, per-run, SSRF-guarded endpoint. We
  // deliberately do NOT fall back to PROXY_BASE_URL or any direct URL here — a
  // workflow/actions container runs untrusted user code, so handing it an open
  // or transparent proxy would defeat the egress SSRF gate. When the gated URL
  // is absent we emit nothing (the container has no worker-mediated egress
  // proxy), leaving container-direct outbound to be denied by the infra-layer
  // network policy that still has to be applied (see TAKOS_EGRESS_PROXY_URL doc
  // and the proposed Cloudflare Container network policy).
  const gatedEgressProxyUrl = normalizeGatedEgressProxyUrl(
    env.TAKOS_EGRESS_PROXY_URL,
  );
  if (gatedEgressProxyUrl) {
    containerEnv[CONTAINER_EGRESS_PROXY_ENV] = gatedEgressProxyUrl;
  }

  return containerEnv;
}

/**
 * Defensively normalize the configured egress proxy URL before it is handed to
 * an untrusted container. Fails closed (returns null, so the var is omitted)
 * rather than forwarding a value that is malformed, non-HTTP(S), or carries
 * embedded credentials. This does NOT by itself make the endpoint gated — that
 * is an operator/infra responsibility (the URL must terminate at the SSRF-
 * guarded egress) — it only refuses to propagate an obviously-unsafe value.
 */
export function normalizeGatedEgressProxyUrl(
  value: string | undefined,
): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return null;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return null;
  }
  if (parsed.username || parsed.password) {
    return null;
  }
  return parsed.toString();
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

  constructor(ctx: DurableObjectStateBinding<Record<string, never>>, env: Env) {
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

    if (!this.cachedTokens) {
      throw new Error(
        "cachedTokens missing after ensureProxyTokensLoaded",
      );
    }
    this.cachedTokens.set(token, info);
    await this.persistProxyTokens();
    return token;
  }

  /** RPC method: called by the worker fetch handler to verify proxy tokens. */
  async verifyProxyToken(token: string): Promise<RuntimeProxyTokenInfo | null> {
    await this.ensureProxyTokensLoaded(Date.now());
    if (!this.cachedTokens) return null;

    for (const [storedToken, info] of this.cachedTokens) {
      if (!constantTimeEqualsString(token, storedToken)) continue;
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
} satisfies PlatformHandler<Env>;
