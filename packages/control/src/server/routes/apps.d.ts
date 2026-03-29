import { Hono } from 'hono';
import type { Env, User } from '../../shared/types';
type Variables = {
    user?: User;
};
/**
 * App type definitions for unified framework
 */
export type AppType = 'platform' | 'builtin' | 'custom';
/**
 * Register App API routes (requires authentication)
 */
export declare function registerAppApiRoutes<V extends Variables>(api: Hono<{
    Bindings: Env;
    Variables: V;
}>): void;
export {};
//# sourceMappingURL=apps.d.ts.map