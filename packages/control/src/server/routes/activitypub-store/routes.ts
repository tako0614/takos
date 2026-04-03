import { Hono } from "hono";
import type { PublicRouteEnv } from "../route-auth.ts";
import { activitypubStoreDeps, setActivitypubStoreTestDeps } from "./deps.ts";
import { registerRepoRoutes } from "./repo-routes.ts";
import { registerStoreRoutes } from "./store-routes.ts";
import { registerWebfingerRoutes } from "./webfinger.ts";

const activitypubStore = new Hono<PublicRouteEnv>();

registerWebfingerRoutes(activitypubStore, activitypubStoreDeps);
registerStoreRoutes(activitypubStore, activitypubStoreDeps);
registerRepoRoutes(activitypubStore, activitypubStoreDeps);

export { setActivitypubStoreTestDeps };

export default activitypubStore;
