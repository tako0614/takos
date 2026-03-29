import { Hono } from 'hono';
import type { Env } from '../../shared/types';
import type { BaseVariables } from './route-auth';
type NotificationSseRouteEnv = {
    Bindings: Env;
    Variables: BaseVariables;
};
/**
 * SSE endpoint for user notifications — alternative to the WebSocket-based
 * DO notifier for Node.js / k8s environments.
 *
 * GET /api/notifications/sse
 */
export declare function createNotificationSseRouter(): Hono<NotificationSseRouteEnv>;
export {};
//# sourceMappingURL=notifications-sse.d.ts.map