import { test } from "bun:test";
import { assertEquals } from "@std/assert";

import { createApiRouter } from "../../api.ts";

test("space tools routes are mounted under /spaces/:spaceId/tools", () => {
  const noop = async (_c: unknown, next: () => Promise<void>) => {
    await next();
  };

  const router = createApiRouter({
    requireAuth: noop as never,
    optionalAuth: noop as never,
  });

  const signatures = router.routes.map((
    route: { method: string; path: string },
  ) => `${route.method} ${route.path}`);

  assertEquals(signatures.includes("GET /spaces/:spaceId/tools"), true);
  assertEquals(
    signatures.includes("GET /spaces/:spaceId/tools/:toolName"),
    true,
  );
});
