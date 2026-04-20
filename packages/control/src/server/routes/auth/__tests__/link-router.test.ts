import { assertEquals } from "jsr:@std/assert";

import { authLinkRouter } from "../link.ts";

Deno.test("auth link routes are mounted beneath /auth without an api prefix", () => {
  const signatures = authLinkRouter.routes.map((
    route: { method: string; path: string },
  ) => `${route.method} ${route.path}`);

  assertEquals(signatures.includes("GET /link/google"), true);
  assertEquals(signatures.includes("GET /link/google/callback"), true);
  assertEquals(signatures.includes("GET /identities"), false);
  assertEquals(signatures.includes("GET /api/auth/identities"), false);
});
