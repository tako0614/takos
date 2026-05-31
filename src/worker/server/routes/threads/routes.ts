import { Hono } from "hono";
import type { Env } from "../../../shared/types/index.ts";
import type { BaseVariables } from "../route-auth.ts";
import { registerThreadMessageRoutes } from "./messages.ts";
import { registerThreadShareRoutes } from "./shares.ts";
import { registerThreadSpaceRoutes } from "./space.ts";
import { registerThreadCrudRoutes } from "./thread.ts";

const threadsRoutes = new Hono<{ Bindings: Env; Variables: BaseVariables }>();

registerThreadSpaceRoutes(threadsRoutes);
registerThreadCrudRoutes(threadsRoutes);
registerThreadMessageRoutes(threadsRoutes);
registerThreadShareRoutes(threadsRoutes);

export default threadsRoutes;
