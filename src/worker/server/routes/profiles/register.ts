import type { Hono, MiddlewareHandler } from "hono";
import type { Env, User } from "../../../shared/types/index.ts";
import profiles from "./index.ts";

type ProfileVariables = {
  user?: User;
};

type ProfileAuthMiddleware = MiddlewareHandler<
  { Bindings: Env; Variables: ProfileVariables }
>;

export function registerProfileRoutes(
  app: Hono<{ Bindings: Env; Variables: ProfileVariables }>,
  optionalAuth: ProfileAuthMiddleware,
) {
  // Profile routes (public, with optional auth for follow status)
  // - Page routes at /@:username serve SPA HTML for browsers
  // - API requests with Accept: application/json are handled by API router above
  app.use("/@*", optionalAuth);
  app.route("/@", profiles);
}
