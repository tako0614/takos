import { Hono } from "hono";
import type { AuthenticatedRouteEnv } from "../route-auth.ts";
import { registerStoreRegistryCrudRoutes } from "./store-registry-crud.ts";
import { registerStoreRegistryRepositoryRoutes } from "./store-registry-repositories.ts";
import { registerStoreRegistryUpdateRoutes } from "./store-registry-updates.ts";

const storeRegistryRoutes = new Hono<AuthenticatedRouteEnv>();

registerStoreRegistryCrudRoutes(storeRegistryRoutes);
registerStoreRegistryRepositoryRoutes(storeRegistryRoutes);
registerStoreRegistryUpdateRoutes(storeRegistryRoutes);

export { storeRegistryRouteDeps } from "./store-registry-helpers.ts";

export default storeRegistryRoutes;
