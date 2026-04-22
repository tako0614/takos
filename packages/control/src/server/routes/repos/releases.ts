import { Hono } from "hono";
import type { AuthenticatedRouteEnv } from "../route-auth.ts";
import releaseCrud from "./release-crud.ts";
import releaseAssets from "./release-assets.ts";

export default new Hono<AuthenticatedRouteEnv>()
  .route("/", releaseCrud)
  .route("/", releaseAssets);
