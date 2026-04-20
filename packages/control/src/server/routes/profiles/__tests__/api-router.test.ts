import { assertEquals } from "jsr:@std/assert";

import { createApiRouter } from "../../api.ts";

Deno.test("profile repo routes are mounted under /api/users", () => {
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

  for (
    const signature of [
      "GET /users/:username/:repoName",
      "GET /users/:username/:repoName/tree/:ref",
      "GET /users/:username/:repoName/blob/:ref",
      "GET /users/:username/:repoName/commits",
      "GET /users/:username/:repoName/branches",
      "DELETE /users/:username/:repoName",
    ]
  ) {
    assertEquals(signatures.includes(signature), true, signature);
  }

  assertEquals(signatures.includes("GET /users/:username/repos"), true);
});
