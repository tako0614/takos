import { Hono } from 'hono';
import type { PublicRouteEnv } from '../route-auth';
declare const oauthAuthorize: Hono<PublicRouteEnv, import("hono/types").BlankSchema, "/">;
export default oauthAuthorize;
//# sourceMappingURL=authorize.d.ts.map