import { assertEquals } from "@std/assert";
import { Hono } from "hono";
import { isAppError } from "@takos/worker-platform-utils/errors";

import groupsRouter, { groupsRouteDeps } from "./routes.ts";
import { routeAuthDeps } from "../route-auth.ts";
import type { Env } from "../../../shared/types/index.ts";

const originalRouteAuthDeps = { ...routeAuthDeps };
const originalGroupsRouteDeps = { ...groupsRouteDeps };

function restoreDeps() {
  Object.assign(routeAuthDeps, originalRouteAuthDeps);
  Object.assign(groupsRouteDeps, originalGroupsRouteDeps);
}

function createApp() {
  const app = new Hono<
    { Bindings: Env; Variables: { user: { id: string } } }
  >();
  app.onError((error, c) => {
    if (isAppError(error)) {
      return c.json(
        error.toResponse(),
        error.statusCode as
          | 400
          | 401
          | 403
          | 404
          | 409
          | 410
          | 422
          | 429
          | 500
          | 501
          | 502
          | 503
          | 504,
      );
    }
    throw error;
  });
  app.use("*", async (c, next) => {
    c.set("user", { id: "user-1" });
    await next();
  });
  app.route("/", groupsRouter);
  return app;
}

Deno.test("groups routes do not expose direct deployment collection", async () => {
  const calls: unknown[] = [];
  routeAuthDeps.requireSpaceAccess = async (_c, spaceId, userId, roles) => {
    calls.push({ kind: "access", spaceId, userId, roles });
    return { space: { id: "space-1" } } as never;
  };
  try {
    const response = await createApp().request(
      "/spaces/space-alias/groups/deployments",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          source: {
            kind: "git_ref",
            repository_url: "https://example.com/acme/demo.git",
            ref: "main",
            ref_type: "branch",
          },
          env: "staging",
        }),
      },
      { DB: {} } as Env,
    );
    assertEquals(response.status, 404);
    assertEquals(calls, []);
  } finally {
    restoreDeps();
  }
});

Deno.test("groups routes do not parse direct deployment bodies", async () => {
  routeAuthDeps.requireSpaceAccess = async () =>
    ({ space: { id: "space-1" } }) as never;
  try {
    const response = await createApp().request(
      "/spaces/space-1/groups/deployments",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          source: {
            kind: "git_ref",
            repository_url: "https://example.com/acme/demo.git",
            ref: "main",
            ref_type: "branch",
            backend: "cloudflare",
          },
        }),
      },
      { DB: {} } as Env,
    );
    assertEquals(response.status, 404);
  } finally {
    restoreDeps();
  }
});

Deno.test("groups routes do not expose direct rollback routes", async () => {
  routeAuthDeps.requireSpaceAccess = async () =>
    ({ space: { id: "space-1" } }) as never;
  try {
    for (
      const path of [
        "/spaces/space-1/groups/deployments/snap-1/rollback",
        "/spaces/space-1/groups/group-1/rollback",
        "/spaces/space-1/groups/by-name/demo/rollback",
      ]
    ) {
      const response = await createApp().request(
        path,
        { method: "POST" },
        { DB: {} } as Env,
      );
      assertEquals(response.status, 404);
    }
  } finally {
    restoreDeps();
  }
});
