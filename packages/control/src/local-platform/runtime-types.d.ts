import type { PlatformExecutionContext } from '../shared/types/bindings.ts';
import type { BrowserSessionState, BrowserSessionTokenInfo, CreateSessionPayload } from '../runtime/container-hosts/browser-session-types.ts';
import type { AgentExecutorControlConfig, AgentExecutorDispatchPayload } from '../runtime/container-hosts/executor-dispatch.ts';
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
export declare const DEFAULT_LOCAL_PORTS: {
    readonly web: 8787;
    readonly dispatch: 8788;
    readonly runtimeHost: 8789;
    readonly executorHost: 8790;
    readonly browserHost: 8791;
};
/**
 * Default container-internal ports for service processes.
 * Each container listens on this port; the host-side mapping is in
 * {@link DEFAULT_LOCAL_PORTS}.
 */
export declare const DEFAULT_LOCAL_SERVICE_PORTS: {
    readonly runtime: 8080;
    readonly executor: 8080;
    readonly browser: 8080;
};
/**
 * Default domain names for the local-platform stack.
 *
 * These values are the single source of truth for TypeScript code.
 * The same domain names are duplicated in build-time / env config files
 * that cannot import this module. Keep them in sync when changing:
 *   - .env.local.example                        (TAKOS_ADMIN_DOMAIN etc.)
 *   - apps/control/.env.self-host.example        (TAKOS_ADMIN_DOMAIN etc.)
 */
export declare const DEFAULT_LOCAL_DOMAINS: {
    /** Admin panel domain (matches TAKOS_ADMIN_DOMAIN in env examples). */
    readonly admin: "admin.localhost";
    /** Tenant sub-domain base (matches TAKOS_TENANT_BASE_DOMAIN in env examples). */
    readonly tenantBase: "app.localhost";
};
export type LocalFetch = (request: Request, executionContext?: PlatformExecutionContext) => Promise<Response>;
export type LocalBinding = {
    fetch(request: Request): Promise<Response>;
};
export type LocalRuntimeGatewayStub = LocalBinding & {
    verifyProxyToken(token: string): Promise<{
        sessionId: string;
        spaceId: string;
    } | null>;
};
export type ProxyTokenInfo = {
    runId: string;
    serviceId: string;
    capability: 'bindings' | 'control';
};
export type LocalExecutorGatewayStub = {
    dispatchStart(body: AgentExecutorDispatchPayload): Promise<{
        ok: boolean;
        status: number;
        body: string;
    }>;
    verifyProxyToken(token: string): Promise<ProxyTokenInfo | null>;
};
export type LocalBrowserGatewayStub = LocalBinding & {
    createSession(payload: CreateSessionPayload): Promise<{
        ok: true;
        proxyToken: string;
    }>;
    verifyProxyToken(token: string): Promise<BrowserSessionTokenInfo | null>;
    getSessionState(): Promise<BrowserSessionState | null>;
    destroySession(): Promise<void>;
    forwardToContainer(path: string, init?: RequestInit): Promise<Response>;
};
export type { AgentExecutorControlConfig, AgentExecutorDispatchPayload };
export type { BrowserSessionState, BrowserSessionTokenInfo, CreateSessionPayload };
//# sourceMappingURL=runtime-types.d.ts.map