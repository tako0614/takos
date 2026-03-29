import { Hono, type MiddlewareHandler } from 'hono';
import type { Env, User } from '../../../shared/types';
type ProfileVariables = {
    user?: User;
};
type ProfileAuthMiddleware = MiddlewareHandler<{
    Bindings: Env;
    Variables: ProfileVariables;
}>;
export declare function registerProfileRoutes(app: Hono<{
    Bindings: Env;
    Variables: ProfileVariables;
}>, optionalAuth: ProfileAuthMiddleware): void;
export {};
//# sourceMappingURL=register.d.ts.map