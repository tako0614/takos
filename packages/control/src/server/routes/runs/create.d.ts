import type { Hono } from 'hono';
import type { Env } from '../../../shared/types';
import type { BaseVariables } from '../route-auth';
type RunRouteApp = Hono<{
    Bindings: Env;
    Variables: BaseVariables;
}>;
export declare function registerRunCreateRoutes(app: RunRouteApp): void;
export {};
//# sourceMappingURL=create.d.ts.map