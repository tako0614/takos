/**
 * Git Smart HTTP route handler.
 *
 * URL pattern: /git/:owner/:repo.git/<service>
 * - GET  /git/:owner/:repo.git/info/refs?service=<service>
 * - POST /git/:owner/:repo.git/git-upload-pack
 * - POST /git/:owner/:repo.git/git-receive-pack
 */
import { Hono } from 'hono';
import type { Env, User } from '../../shared/types';
type Variables = {
    user?: User;
};
declare const smartHttpRoutes: Hono<{
    Bindings: Env;
    Variables: Variables;
}, import("hono/types").BlankSchema, "/">;
export { smartHttpRoutes };
//# sourceMappingURL=smart-http.d.ts.map