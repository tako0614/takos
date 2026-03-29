/**
 * Edge API routes for browser sessions.
 *
 * Each route authenticates the user, verifies session ownership,
 * and forwards to the BROWSER_HOST service binding (if configured).
 * Returns 503 when the binding is not available.
 */
import { Hono } from 'hono';
import type { Env, User } from '../../shared/types';
type BrowserSessionVariables = {
    user?: User;
};
declare const browserSessions: Hono<{
    Bindings: Env;
    Variables: BrowserSessionVariables;
}, import("hono/types").BlankSchema, "/">;
export default browserSessions;
//# sourceMappingURL=browser-sessions.d.ts.map