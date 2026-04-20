import { assertEquals } from "jsr:@std/assert";

import {
  collectRequestedSpaceIds,
  enforceSpaceScopeMiddleware,
  getScopedSpaceId,
  getSpaceIdFromPath,
  hasAnySpaceScopeMismatch,
  hasSpaceScopeMismatch,
  SPACE_SCOPE_MISMATCH_ERROR,
} from "../../middleware/space-scope.ts";
import { createTestApp, testRequest } from "../setup.ts";

function createContext(overrides: {
  path?: string;
  serviceToken?: { scope_space_id?: string } | null;
  parsedBody?: Record<string, unknown>;
} = {}) {
  const {
    path = "/repos/ws1/myrepo",
    serviceToken = null,
    parsedBody,
  } = overrides;

  return {
    req: {
      path,
      header: () => undefined,
    },
    get(key: string) {
      if (key === "serviceToken") return serviceToken;
      if (key === "parsedBody") return parsedBody;
      return undefined;
    },
  };
}

Deno.test(
  "getSpaceIdFromPath - extracts space ID from /repos/:spaceId/:repo path",
  () => {
    const c = createContext({ path: "/repos/ws1/myrepo" });
    assertEquals(getSpaceIdFromPath(c as never), "ws1");
  },
);

Deno.test("getSpaceIdFromPath - extracts space ID from deeper paths", () => {
  const c = createContext({ path: "/repos/ws1/myrepo/branches" });
  assertEquals(getSpaceIdFromPath(c as never), "ws1");
});

Deno.test("getSpaceIdFromPath - returns null for non-repos path", () => {
  const c = createContext({ path: "/api/health" });
  assertEquals(getSpaceIdFromPath(c as never), null);
});

Deno.test("getSpaceIdFromPath - returns null for too-short repos path", () => {
  const c = createContext({ path: "/repos/ws1" });
  assertEquals(getSpaceIdFromPath(c as never), null);
});

Deno.test("getSpaceIdFromPath - returns null for empty repos path", () => {
  const c = createContext({ path: "/repos" });
  assertEquals(getSpaceIdFromPath(c as never), null);
});

Deno.test("collectRequestedSpaceIds - returns unique non-empty strings", () => {
  assertEquals(collectRequestedSpaceIds(["ws1", "ws2", "ws1"]), ["ws1", "ws2"]);
});

Deno.test("collectRequestedSpaceIds - filters out non-string values", () => {
  assertEquals(collectRequestedSpaceIds([null, undefined, 123, "ws1"]), [
    "ws1",
  ]);
});

Deno.test("collectRequestedSpaceIds - filters out empty strings", () => {
  assertEquals(collectRequestedSpaceIds(["", "ws1", ""]), ["ws1"]);
});

Deno.test("collectRequestedSpaceIds - returns empty array for all-invalid input", () => {
  assertEquals(collectRequestedSpaceIds([null, undefined, "", 0]), []);
});

Deno.test("getScopedSpaceId - returns scope_space_id from service token", () => {
  const c = createContext({ serviceToken: { scope_space_id: "ws1" } });
  assertEquals(getScopedSpaceId(c as never), "ws1");
});

Deno.test("getScopedSpaceId - returns undefined when no service token", () => {
  const c = createContext({ serviceToken: null });
  assertEquals(getScopedSpaceId(c as never), undefined);
});

Deno.test("getScopedSpaceId - returns undefined when scope_space_id is not a string", () => {
  const c = createContext({ serviceToken: { scope_space_id: 123 } as never });
  assertEquals(getScopedSpaceId(c as never), undefined);
});

Deno.test("hasSpaceScopeMismatch - returns false when no service token", () => {
  const c = createContext({ serviceToken: null });
  assertEquals(hasSpaceScopeMismatch(c as never, "ws1"), false);
});

Deno.test("hasSpaceScopeMismatch - returns false when spaceId matches scope", () => {
  const c = createContext({ serviceToken: { scope_space_id: "ws1" } });
  assertEquals(hasSpaceScopeMismatch(c as never, "ws1"), false);
});

Deno.test("hasSpaceScopeMismatch - returns true when spaceId does not match scope", () => {
  const c = createContext({ serviceToken: { scope_space_id: "ws1" } });
  assertEquals(hasSpaceScopeMismatch(c as never, "ws2"), true);
});

Deno.test("hasSpaceScopeMismatch - returns false when spaceId is empty/null/undefined", () => {
  const c = createContext({ serviceToken: { scope_space_id: "ws1" } });
  assertEquals(hasSpaceScopeMismatch(c as never, ""), false);
  assertEquals(hasSpaceScopeMismatch(c as never, null), false);
  assertEquals(hasSpaceScopeMismatch(c as never, undefined), false);
});

Deno.test("hasAnySpaceScopeMismatch - returns false when all match", () => {
  const c = createContext({ serviceToken: { scope_space_id: "ws1" } });
  assertEquals(hasAnySpaceScopeMismatch(c as never, ["ws1", "ws1"]), false);
});

Deno.test("hasAnySpaceScopeMismatch - returns true when any mismatch", () => {
  const c = createContext({ serviceToken: { scope_space_id: "ws1" } });
  assertEquals(hasAnySpaceScopeMismatch(c as never, ["ws1", "ws2"]), true);
});

Deno.test("hasAnySpaceScopeMismatch - returns false for empty array", () => {
  const c = createContext({ serviceToken: { scope_space_id: "ws1" } });
  assertEquals(hasAnySpaceScopeMismatch(c as never, []), false);
});

Deno.test("SPACE_SCOPE_MISMATCH_ERROR - is the expected string", () => {
  assertEquals(
    SPACE_SCOPE_MISMATCH_ERROR,
    "Token space scope does not match requested space",
  );
});

Deno.test(
  "enforceSpaceScopeMiddleware - forbids conflicting space identifiers",
  async () => {
    const app = createTestApp();

    app.use("*", async (c, next) => {
      const ctx = c as any;
      ctx.set("serviceToken", { scope_space_id: "ws1" });
      if ((c.req.header("content-type") || "").includes("application/json")) {
        ctx.set("parsedBody", await c.req.json());
      }
      await next();
    });

    app.use(
      "/scoped/*",
      enforceSpaceScopeMiddleware((c) => [
        (c.get("parsedBody") as Record<string, unknown> | undefined)?.spaceId,
        (c.get("parsedBody") as Record<string, unknown> | undefined)?.space_id,
      ]),
    );

    app.post("/scoped/test", (c) => c.json({ ok: true }));

    const response = await testRequest(app, {
      method: "POST",
      path: "/scoped/test",
      body: { space_id: "ws1", spaceId: "ws2" },
    });

    assertEquals(response.status, 403);
    assertEquals(response.body, {
      error: {
        code: "FORBIDDEN",
        message: "Conflicting space identifiers in request",
      },
    });
  },
);

Deno.test(
  "enforceSpaceScopeMiddleware - forbids token/request space mismatches",
  async () => {
    const app = createTestApp();

    app.use("*", async (c, next) => {
      const ctx = c as any;
      ctx.set("serviceToken", { scope_space_id: "ws1" });
      if ((c.req.header("content-type") || "").includes("application/json")) {
        ctx.set("parsedBody", await c.req.json());
      }
      await next();
    });

    app.use(
      "/scoped/*",
      enforceSpaceScopeMiddleware((c) => [
        (c.get("parsedBody") as Record<string, unknown> | undefined)?.space_id,
      ]),
    );

    app.post("/scoped/test", (c) => c.json({ ok: true }));

    const response = await testRequest(app, {
      method: "POST",
      path: "/scoped/test",
      body: { space_id: "ws2" },
    });

    assertEquals(response.status, 403);
    assertEquals(response.body, {
      error: {
        code: "FORBIDDEN",
        message: "Token space scope does not match requested space",
      },
    });
  },
);
