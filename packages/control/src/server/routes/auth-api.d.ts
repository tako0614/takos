/**
 * Auth API Routes for takos-control
 *
 * Profile management endpoints.
 * Google OAuth is the sole authentication method.
 */
import { Hono } from 'hono';
import type { Env, User } from '../../shared/types';
type Variables = {
    user?: User;
};
declare const authApi: Hono<{
    Bindings: Env;
    Variables: Variables;
}, import("hono/types").BlankSchema, "/">;
export default authApi;
//# sourceMappingURL=auth-api.d.ts.map