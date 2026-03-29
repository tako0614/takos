import { Hono } from 'hono';
import type { Env } from '../../../shared/types';
import type { BaseVariables } from '../route-auth';
declare const sessions: Hono<{
    Bindings: Env;
    Variables: BaseVariables;
}, import("hono/types").BlankSchema, "/">;
export default sessions;
//# sourceMappingURL=index.d.ts.map