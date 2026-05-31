import { Hono } from "hono";
import type { AuthenticatedRouteEnv } from "../route-auth.ts";
import resourcesAccess from "./access.ts";
import resourcesBase from "./routes.ts";
import resourcesBindings from "./bindings.ts";
import resourcesConnection from "./connection.ts";
import resourcesD1 from "./d1.ts";
import resourcesKv from "./kv.ts";
import resourcesR2 from "./r2.ts";

export default new Hono<AuthenticatedRouteEnv>()
  .route("/", resourcesBase)
  .route("/", resourcesAccess)
  .route("/", resourcesBindings)
  .route("/", resourcesConnection)
  .route("/", resourcesD1)
  .route("/", resourcesKv)
  .route("/", resourcesR2);
