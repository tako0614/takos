import { Hono } from "hono";
import type { Env, User } from "@/types";
import { createMockEnv } from "../../../test/integration/setup.ts";

import { assertEquals } from "@std/assert";
import { isAppError } from "@takos/worker-platform-utils/errors";
import { asyncNoopDep } from "@test/dep-stubs";

type LooseAsyncFn = (...args: unknown[]) => Promise<unknown>;

const mocks: {
  createShortcut: LooseAsyncFn;
  deleteShortcut: LooseAsyncFn;
  getOrCreatePersonalWorkspace: LooseAsyncFn;
  listShortcuts: LooseAsyncFn;
  updateShortcut: LooseAsyncFn;
} = {
  createShortcut: asyncNoopDep("shortcuts.createShortcut"),
  deleteShortcut: asyncNoopDep("shortcuts.deleteShortcut"),
  getOrCreatePersonalWorkspace: asyncNoopDep(
    "shortcuts.getOrCreatePersonalWorkspace",
  ),
  listShortcuts: async () => [],
  updateShortcut: asyncNoopDep("shortcuts.updateShortcut"),
};

// [Deno] vi.mock removed - manually stub imports from '@/services/identity/shortcuts'
// [Deno] vi.mock removed - manually stub imports from '@/services/identity/spaces'
import shortcutsRoutes from "@/routes/shortcuts";
import { shortcutsRouteDeps } from "@/routes/shortcuts";

function createUser(): User {
  return {
    id: "user-1",
    email: "user1@example.com",
    name: "User One",
    username: "user1",
    bio: null,
    picture: null,
    trust_tier: "normal",
    setup_completed: true,
    created_at: "2026-03-01T00:00:00.000Z",
    updated_at: "2026-03-01T00:00:00.000Z",
  };
}

function createApp(
  user: User,
): Hono<{ Bindings: Env; Variables: { user: User } }> {
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
    c.set("user", user);
    await next();
  });
  app.route("/api/shortcuts", shortcutsRoutes);
  return app;
}

Deno.test("shortcuts routes input validation - rejects unknown shortcut resource types", async () => {
  // No longer used since shortcuts now use user.id directly
  shortcutsRouteDeps.listShortcuts =
    (async () => []) as typeof shortcutsRouteDeps.listShortcuts;
  shortcutsRouteDeps.createShortcut = mocks
    .createShortcut as typeof shortcutsRouteDeps.createShortcut;
  const app = createApp(createUser());
  const response = await app.fetch(
    new Request("http://localhost/api/shortcuts", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: "Legacy Project Shortcut",
        resourceType: "project",
        resourceId: "proj-1",
      }),
    }),
    createMockEnv(),
    {} as ExecutionContext,
  );

  assertEquals(response.status, 400);
  const json = await response.json() as Record<string, unknown>;
  assertEquals((json.error as Record<string, unknown>).code, "BAD_REQUEST");
});
