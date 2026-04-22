import { Hono } from "hono";
import type { AuthenticatedRouteEnv } from "../route-auth.ts";
import workersBase from "./routes.ts";
import workersDeployments from "./deployments.ts";
import workersSettings from "./settings.ts";
import workersSlug from "./slug.ts";

export default new Hono<AuthenticatedRouteEnv>()
  .route("/", workersBase)
  .route("/", workersDeployments)
  .route("/", workersSettings)
  .route("/", workersSlug);
