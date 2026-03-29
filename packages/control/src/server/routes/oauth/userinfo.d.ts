import { Hono } from 'hono';
import type { PublicRouteEnv } from '../route-auth';
declare const oauthUserinfo: Hono<PublicRouteEnv, import("hono/types").BlankSchema, "/">;
export default oauthUserinfo;
//# sourceMappingURL=userinfo.d.ts.map