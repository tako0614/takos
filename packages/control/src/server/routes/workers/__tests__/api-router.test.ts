import { assertEquals } from "jsr:@std/assert";

import { createApiRouter } from "../../api.ts";

Deno.test("worker service listing is mounted under /spaces/:spaceId/services", () => {
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

  assertEquals(signatures.includes("GET /spaces/:spaceId/services"), true);
  assertEquals(signatures.includes("GET /services/space/:spaceId"), false);
  assertEquals(signatures.includes("GET /space/:spaceId"), false);
});
