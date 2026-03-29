import { Hono } from 'hono';
import type { Env } from '../../../shared/types';
import type { BaseVariables } from '../route-auth';
declare const index: Hono<{
    Bindings: Env;
    Variables: BaseVariables;
}, import("hono/types").BlankSchema, "/">;
export default index;
//# sourceMappingURL=index.d.ts.map