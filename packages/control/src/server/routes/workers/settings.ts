import { Hono } from "hono";
import type { AuthenticatedRouteEnv } from "../route-auth.ts";
import settingsConfig from "./settings-config.ts";
import settingsConsumes from "./settings-consumes.ts";
import settingsEnvVars from "./settings-env-vars.ts";

const workersSettings = new Hono<AuthenticatedRouteEnv>()
  .route("/", settingsConfig)
  .route("/", settingsEnvVars)
  .route("/", settingsConsumes);

export default workersSettings;
