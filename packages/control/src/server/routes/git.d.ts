import { Hono } from 'hono';
import type { Env } from '../../shared/types';
import { type BaseVariables } from './route-auth';
declare const git: Hono<{
    Bindings: Env;
    Variables: BaseVariables;
}, import("hono/types").BlankSchema, "/">;
export default git;
//# sourceMappingURL=git.d.ts.map