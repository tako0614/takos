import { expect, test } from "bun:test";
import { createApiRouter } from "../api.ts";

test("Takos API does not mount Workspace membership routes", () => {
  const router = createApiRouter({
    requireAuth: async (_c, next) => await next(),
    optionalAuth: async (_c, next) => await next(),
  });
  const mountedPaths = router.routes.map((route) => route.path);

  expect(
    mountedPaths.some((path) =>
      path === "/spaces/:spaceId/members" ||
      path.startsWith("/spaces/:spaceId/members/")
    ),
  ).toBe(false);
});
