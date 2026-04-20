import type { PlatformExecutionContext } from "../shared/types/bindings.ts";
import type {
  AgentExecutorControlConfig,
  AgentExecutorDispatchPayload,
} from "../runtime/container-hosts/executor-dispatch.ts";

/**
 * Default host-side ports for the local-platform stack.
 *
 * These values are the single source of truth for all port numbers.
 * TypeScript source files should import this constant directly.
 *
 * NOTE: There is no auto-generation step for .env templates yet.
 * When changing port numbers here, you MUST update ALL of the following
 * non-TS config files manually to keep them in sync:
 *   - .env.local.example                        (TAKOS_CONTROL_WEB_PORT etc.)
 *   - .env.self-host                            (TAKOS_CONTROL_WEB_PORT etc.)
 *   - apps/runtime/.env.example                 (TAKOS_API_URL port)
 *   - scripts/local-smoke.mjs                   (defaults object)
 *   - deploy/helm/takos/values.yaml             (port fields)
 */
export const DEFAULT_LOCAL_PORTS = {
  web: 8787,
  dispatch: 8788,
  runtimeHost: 8789,
  executorHost: 8790,
} as const;

/**
 * Default container-internal ports for service processes.
 * Each container listens on this port; the host-side mapping is in
 * {@link DEFAULT_LOCAL_PORTS}.
 */
export const DEFAULT_LOCAL_SERVICE_PORTS = {
  runtime: 8080,
  executor: 8080,
} as const;

/**
 * Default domain names for the local-platform stack.
 *
 * These values are the single source of truth for TypeScript code.
 * The same domain names are duplicated in build-time / env config files
 * that cannot import this module. Keep them in sync when changing:
 *   - .env.local.example                        (TAKOS_ADMIN_DOMAIN etc.)
 *   - apps/control/.env.self-host.example        (TAKOS_ADMIN_DOMAIN etc.)
 */
export const DEFAULT_LOCAL_DOMAINS = {
  /** Admin panel domain (matches TAKOS_ADMIN_DOMAIN in env examples). */
  admin: "admin.localhost",
  /** Tenant sub-domain base (matches TAKOS_TENANT_BASE_DOMAIN in env examples). */
  tenantBase: "app.localhost",
} as const;

export type LocalFetch = (
  request: Request,
  executionContext?: PlatformExecutionContext,
) => Promise<Response>;

export type LocalBinding = {
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
};

export type LocalRuntimeGatewayStub = LocalBinding & {
  verifyProxyToken(
    token: string,
  ): Promise<{ sessionId: string; spaceId: string } | null>;
  revokeSessionProxyTokens(sessionId: string): Promise<number>;
};

export type ProxyTokenInfo = {
  runId: string;
  serviceId: string;
  capability: "control";
};

export type LocalExecutorGatewayStub = {
  dispatchStart(
    body: AgentExecutorDispatchPayload,
  ): Promise<{ ok: boolean; status: number; body: string }>;
  verifyProxyToken(token: string): Promise<ProxyTokenInfo | null>;
};

export type { AgentExecutorControlConfig, AgentExecutorDispatchPayload };
