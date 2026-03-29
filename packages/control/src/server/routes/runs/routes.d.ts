import { Hono } from 'hono';
import type { Env } from '../../../shared/types';
import type { BaseVariables } from '../route-auth';
type RunRouteEnv = {
    Bindings: Env;
    Variables: BaseVariables;
};
type RunRouteApp = Hono<RunRouteEnv>;
declare const router: RunRouteApp;
export default router;
//# sourceMappingURL=routes.d.ts.map