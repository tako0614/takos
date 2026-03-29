/**
 * Provider linking — add another OAuth identity to an existing account.
 * Requires active session (user must be logged in).
 * Security: never auto-merge by email, only explicit link from authenticated session.
 */
import { Hono } from 'hono';
import type { OptionalAuthRouteEnv } from '../route-auth';
export declare const authLinkRouter: Hono<OptionalAuthRouteEnv, import("hono/types").BlankSchema, "/">;
//# sourceMappingURL=link.d.ts.map