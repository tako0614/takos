import { Hono } from 'hono';
import type { Env } from '../../../shared/types';
import type { BaseVariables } from '../route-auth';
declare const indexRoutes: Hono<{
    Bindings: Env;
    Variables: BaseVariables;
}, import("hono/types").BlankSchema, "/">;
export default indexRoutes;
//# sourceMappingURL=routes.d.ts.map
