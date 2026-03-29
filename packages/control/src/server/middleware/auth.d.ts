import type { MiddlewareHandler } from 'hono';
import type { Env, User } from '../../shared/types';
type AuthVariables = {
    user?: User;
};
type AuthMiddleware = MiddlewareHandler<{
    Bindings: Env;
    Variables: AuthVariables;
}>;
export declare const requireAuth: AuthMiddleware;
export declare const optionalAuth: AuthMiddleware;
export {};
//# sourceMappingURL=auth.d.ts.map