import { Hono } from 'hono';
import type { Env, User } from './shared/types';
import type { PlatformExecutionContext, PlatformScheduledController } from './shared/types/bindings.ts';
import type { ControlPlatform } from './platform/platform-config.ts';
export { SessionDO } from './runtime/durable-objects/session';
export { RunNotifierDO } from './runtime/durable-objects/run-notifier';
export { NotificationNotifierDO } from './runtime/durable-objects/notification-notifier';
export { RateLimiterDO } from './runtime/durable-objects/rate-limiter';
export { RoutingDO } from './runtime/durable-objects/routing';
export { GitPushLockDO } from './runtime/durable-objects/git-push-lock';
type Variables = {
    user?: User;
    platform?: ControlPlatform<Env>;
};
export declare const webApp: Hono<{
    Bindings: Env;
    Variables: Variables;
}, import("hono/types").BlankSchema, "/">;
export declare function getWebApp(): Hono<{
    Bindings: Env;
    Variables: Variables;
}, import("hono/types").BlankSchema, "/">;
export declare const createWebApp: typeof getWebApp;
export declare function createWebWorker(buildPlatform?: (env: Env) => ControlPlatform<Env> | Promise<ControlPlatform<Env>>): {
    fetch(request: Request, env: Env, ctx: PlatformExecutionContext): Promise<Response>;
    scheduled(controller: PlatformScheduledController, env: Env): Promise<void>;
};
export declare const webWorker: {
    fetch(request: Request, env: Env, ctx: PlatformExecutionContext): Promise<Response>;
    scheduled(controller: PlatformScheduledController, env: Env): Promise<void>;
};
export default webWorker;
//# sourceMappingURL=web.d.ts.map
