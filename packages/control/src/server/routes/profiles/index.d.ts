import type { OptionalAuthRouteEnv } from '../route-auth';
import profilesApi from './api';
declare const profiles: import("hono/hono-base").HonoBase<OptionalAuthRouteEnv, import("hono/types").BlankSchema | import("hono/types").MergeSchemaPath<import("hono/types").BlankSchema, "/">, "/", "/">;
export default profiles;
export { profilesApi };
//# sourceMappingURL=index.d.ts.map