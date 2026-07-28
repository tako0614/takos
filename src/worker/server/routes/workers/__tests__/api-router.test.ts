import { test } from "bun:test";
import { assertEquals } from "@takos/test/assert";

import { createApiRouter } from "../../api.ts";

test("Takos does not mount product-local service inventory routes", () => {
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

  assertEquals(
    signatures.some((signature) => / \/?services(?:\/|$)/.test(signature)),
    false,
  );
  assertEquals(signatures.includes("GET /spaces/:spaceId/services"), false);
  assertEquals(signatures.includes("GET /services"), false);
  assertEquals(signatures.includes("POST /services"), false);
  assertEquals(signatures.includes("GET /services/space/:spaceId"), false);
  assertEquals(signatures.includes("GET /space/:spaceId"), false);
});

test("Takos does not mount a product-local deploy or resource lifecycle", () => {
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

  assertEquals(
    signatures.some((signature) =>
      signature.includes("/services/:id/deployments")
    ),
    false,
  );
  assertEquals(
    signatures.some((signature) =>
      / \/?resources(?:\/|$)/.test(signature)
    ),
    false,
  );
  assertEquals(
    signatures.some((signature) =>
      signature.includes("/spaces/:spaceId/groups")
    ),
    false,
  );
  assertEquals(
    signatures.some((signature) => signature.includes("/custom-domains")),
    false,
  );
  assertEquals(
    signatures.includes(
      "POST /spaces/:spaceId/capsules/git-url/plan",
    ),
    true,
  );
  assertEquals(
    signatures.includes(
      "POST /spaces/:spaceId/capsules/git-url/apply",
    ),
    true,
  );
});
