/**
 * Executor RPC Proxy API
 *
 * Exposes /internal/executor-rpc/* endpoints on the main takos-web worker.
 * The executor-host (thin proxy) forwards container Control RPC requests here
 * via its TAKOS_CONTROL service binding, keeping all DB/service access within
 * the main control-plane worker.
 *
 * Authentication: validates X-Takos-Internal header (shared secret between
 * executor-host and main worker via env var).
 */
import { Hono } from 'hono';
import type { Env } from '../shared/types';
export declare function createExecutorProxyRouter(): Hono<{
    Bindings: Env;
}, import("hono/types").BlankSchema, "/">;
//# sourceMappingURL=executor-proxy-api.d.ts.map