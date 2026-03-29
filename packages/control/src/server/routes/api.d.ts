import { Hono, type MiddlewareHandler } from 'hono';
import type { Env, User } from '../../shared/types';
import { type BillingVariables } from '../middleware/billing';
export type ApiVariables = BillingVariables & {
    user?: User;
};
type ApiAuthMiddleware = MiddlewareHandler<{
    Bindings: Env;
    Variables: ApiVariables;
}>;
export declare function createApiRouter({ requireAuth, optionalAuth, }: {
    requireAuth: ApiAuthMiddleware;
    optionalAuth: ApiAuthMiddleware;
}): Hono<{
    Bindings: Env;
    Variables: ApiVariables;
}, import("hono/types").BlankSchema, "/">;
export {};
//# sourceMappingURL=api.d.ts.map