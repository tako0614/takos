import { Hono } from 'hono';
import type { Env } from '../../../shared/types';
import type { BaseVariables } from '../route-auth';
type RunSseRouteEnv = {
    Bindings: Env;
    Variables: BaseVariables;
};
/**
 * SSE endpoint for run events — alternative to the WebSocket-based DO notifier
 * for Node.js / k8s environments.
 *
 * GET /api/runs/:id/sse
 */
export declare function createRunSseRouter(): Hono<RunSseRouteEnv>;
export {};
//# sourceMappingURL=sse.d.ts.map