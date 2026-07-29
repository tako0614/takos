import { test } from "bun:test";
import { assertEquals } from "@takos/test/assert";

import { API_BEARER_SCOPES } from "../../../shared/types/api-scopes.ts";
import { createApiRouter } from "../api.ts";

test("Takos API does not mount standalone Git hosting routes", () => {
  const router = createApiRouter({
    requireAuth: async (_c, next) => await next(),
    optionalAuth: async (_c, next) => await next(),
  });
  const mountedPaths = router.routes.map((route) => route.path);

  assertEquals(
    mountedPaths.some(
      (path) =>
        path === "/repos" ||
        path.startsWith("/repos/") ||
        path === "/spaces/:spaceId/repos" ||
        path.startsWith("/spaces/:spaceId/repos/") ||
        path === "/spaces/:spaceId/init-repo" ||
        path === "/sessions" ||
        path.startsWith("/sessions/") ||
        path === "/spaces/:spaceId/sessions" ||
        path.startsWith("/spaces/:spaceId/sessions/"),
    ),
    false,
  );
});

test("Takos does not expose Git hosting bearer scopes", () => {
  assertEquals("repos:read" in API_BEARER_SCOPES, false);
  assertEquals("repos:write" in API_BEARER_SCOPES, false);
});
