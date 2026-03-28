import type { PlatformExecutionContext } from '../shared/types/bindings.ts';
import type {
  BrowserSessionState,
  BrowserSessionTokenInfo,
  CreateSessionPayload,
} from '../runtime/container-hosts/browser-session-types.ts';
import type {
  AgentExecutorControlConfig,
  AgentExecutorDispatchPayload,
} from '../runtime/container-hosts/executor-dispatch.ts';

/**
 * Default host-side ports for the local-platform stack.
 *
 * These values are the single source of truth for TypeScript code.
 * The same port numbers are duplicated in build-time / env config files
 * that cannot import this module. Keep them in sync when changing:
 *   - apps/control/web/vite.config.ts          (dev server proxy target)
 *   - apps/control/.env.self-host.example       (TAKOS_CONTROL_WEB_PORT etc.)
 *   - .env.local.example                        (TAKOS_CONTROL_WEB_PORT etc.)
 *   - .env.self-host                            (TAKOS_CONTROL_WEB_PORT etc.)
 */
export const DEFAULT_LOCAL_PORTS = {
  web: 8787,
  dispatch: 8788,
  runtimeHost: 8789,
  executorHost: 8790,
  browserHost: 8791,
} as const;

/**
 * Default container-internal ports for service processes.
 * Each container listens on this port; the host-side mapping is in
 * {@link DEFAULT_LOCAL_PORTS}.
 */
export const DEFAULT_LOCAL_SERVICE_PORTS = {
  runtime: 8080,
  executor: 8080,
  browser: 8080,
} as const;

export type LocalFetch = (
  request: Request,
  executionContext?: PlatformExecutionContext,
) => Promise<Response>;

export type LocalBinding = {
  fetch(request: Request): Promise<Response>;
};

export type LocalRuntimeGatewayStub = LocalBinding & {
  verifyProxyToken(token: string): Promise<{ sessionId: string; spaceId: string } | null>;
};

export type ProxyTokenInfo = {
  runId: string;
  serviceId: string;
  capability: 'bindings' | 'control';
};

export type LocalExecutorGatewayStub = {
  dispatchStart(body: AgentExecutorDispatchPayload): Promise<{ ok: boolean; status: number; body: string }>;
  verifyProxyToken(token: string): Promise<ProxyTokenInfo | null>;
};

export type LocalBrowserGatewayStub = LocalBinding & {
  createSession(payload: CreateSessionPayload): Promise<{ ok: true; proxyToken: string }>;
  verifyProxyToken(token: string): Promise<BrowserSessionTokenInfo | null>;
  getSessionState(): Promise<BrowserSessionState | null>;
  destroySession(): Promise<void>;
  forwardToContainer(path: string, init?: RequestInit): Promise<Response>;
};

export type { AgentExecutorControlConfig, AgentExecutorDispatchPayload };
export type { BrowserSessionState, BrowserSessionTokenInfo, CreateSessionPayload };
