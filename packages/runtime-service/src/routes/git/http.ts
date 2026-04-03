import { Hono } from "hono";
import type { RuntimeEnv } from "../../types/hono.d.ts";
import { enforceSpaceScopeMiddleware } from "../../middleware/space-scope.ts";
import {
  buildLfsBatchObjectResponse,
  getLfsObjectPath,
  normalizeLfsOid,
  parseContentLength,
  parseLfsBatchRequest,
} from "./lfs-policy.ts";
import {
  resolveRepoGitDir,
  validateLfsObjectRequest,
  validateRepoParams,
} from "./validators.ts";
import { registerGitBackendRoutes } from "./backend-routes.ts";
import { registerLfsRoutes } from "./lfs.ts";

const app = new Hono<RuntimeEnv>();

const enforceSpaceScope = enforceSpaceScopeMiddleware((c) => [
  c.req.param("spaceId"),
]);

app.use("/git/:spaceId/:repoName.git/*", enforceSpaceScope);

registerLfsRoutes(app);
registerGitBackendRoutes(app);

export default app;

export {
  buildLfsBatchObjectResponse,
  getLfsObjectPath,
  normalizeLfsOid,
  parseContentLength,
  parseLfsBatchRequest,
  resolveRepoGitDir,
  validateLfsObjectRequest,
  validateRepoParams,
};
