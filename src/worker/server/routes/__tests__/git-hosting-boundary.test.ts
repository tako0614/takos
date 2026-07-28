import { test } from "bun:test";
import { assertEquals } from "@takos/test/assert";

import { API_BEARER_SCOPES } from "../../../shared/types/api-scopes.ts";
import { RUNTIME_PROJECTION_CAPABILITIES } from "../../../application/services/source/app-interface-contract.ts";
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

test("Takos delegates Git hosting authority to installed Interface capabilities", () => {
  assertEquals("sourceRepository" in RUNTIME_PROJECTION_CAPABILITIES, false);
  assertEquals(
    RUNTIME_PROJECTION_CAPABILITIES.sourceGitSmartHttp,
    "source.git.smart_http",
  );
  assertEquals(
    RUNTIME_PROJECTION_CAPABILITIES.sourceGitHosting,
    "source.git.hosting",
  );
  assertEquals("repos:read" in API_BEARER_SCOPES, false);
  assertEquals("repos:write" in API_BEARER_SCOPES, false);
});
