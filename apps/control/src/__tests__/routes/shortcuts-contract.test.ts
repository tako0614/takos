import { Hono } from "hono";
import type { Env, User } from "@/types";
import { createMockEnv } from "../../../test/integration/setup.ts";

import { assertEquals } from "jsr:@std/assert";
import { assertSpyCalls, spy } from "jsr:@std/testing/mock";
import { isAppError } from "takos-common/errors";

const mocks = {
  createShortcut: spy((..._args: any[]) => undefined) as any,
  deleteShortcut: ((..._args: any[]) => undefined) as any,
  getOrCreatePersonalWorkspace: ((..._args: any[]) => undefined) as any,
  listShortcuts: ((..._args: any[]) => undefined) as any,
  updateShortcut: ((..._args: any[]) => undefined) as any,
};

// [Deno] vi.mock removed - manually stub imports from '@/services/identity/shortcuts'
// [Deno] vi.mock removed - manually stub imports from '@/services/identity/spaces'
import shortcuts from "@/routes/shortcuts";
import { shortcutsRouteDeps } from "@/routes/shortcuts";

function createApp() {
  const app = new Hono<{ Bindings: Env; Variables: { user: User } }>();
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
    c.set("user", {
      id: "user-1",
      name: "User 1",
      email: "user1@example.com",
    } as User);
    await next();
  });
  app.route("/api/shortcuts", shortcuts);
  return app;
}

Deno.test("shortcut create contract - rejects legacy resource types", async () => {
  // No longer used since shortcuts now use user.id directly
  shortcutsRouteDeps.createShortcut = mocks.createShortcut;
  const app = createApp();
  const response = await app.fetch(
    new Request("http://localhost/api/shortcuts", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        name: "Legacy project shortcut",
        resourceType: "project",
        resourceId: "project-1",
      }),
    }),
    createMockEnv() as unknown as Env,
    {} as ExecutionContext,
  );

  assertEquals(response.status, 400);
  const json = await response.json() as Record<string, unknown>;
  assertEquals((json.error as Record<string, unknown>).code, "BAD_REQUEST");
  assertSpyCalls(mocks.createShortcut, 0);
});
Deno.test("shortcut create contract - allows current worker/resource/link shortcut types", async () => {
  // No longer used since shortcuts now use user.id directly
  mocks.createShortcut = spy(async () => ({
    id: "shortcut-1",
    user_id: "user-1",
    space_id: "space-personal-1",
    resource_type: "service",
    resource_id: "worker-1",
    name: "Service shortcut",
    icon: null,
    position: 0,
    created_at: "2026-03-06T00:00:00.000Z",
    updated_at: "2026-03-06T00:00:00.000Z",
  })) as any;
  shortcutsRouteDeps.createShortcut = mocks.createShortcut;

  const app = createApp();
  const response = await app.fetch(
    new Request("http://localhost/api/shortcuts", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        name: "Service shortcut",
        resourceType: "service",
        resourceId: "worker-1",
      }),
    }),
    createMockEnv() as unknown as Env,
    {} as ExecutionContext,
  );

  assertEquals(response.status, 201);
  assertEquals(mocks.createShortcut.calls[0]?.args.slice(1), [
    "user-1",
    "user-1",
    {
      name: "Service shortcut",
      resourceType: "service",
      resourceId: "worker-1",
    },
  ]);
});
