import { Hono } from "hono";
import { isAppError } from "takos-common/errors";
import { assertEquals } from "jsr:@std/assert";
import { assertSpyCalls, spy } from "jsr:@std/testing/mock";

import type { Env, User } from "@/types";
import { createMockEnv } from "../../../test/integration/setup.ts";
import { appsRouteDeps, registerAppApiRoutes } from "@/routes/apps";

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
  registerAppApiRoutes(app);
  return app;
}

function withAppsDeps<T>(
  overrides: Partial<typeof appsRouteDeps>,
  fn: () => Promise<T>,
) {
  const previous = { ...appsRouteDeps };
  Object.assign(appsRouteDeps, overrides);
  return fn().finally(() => {
    Object.assign(appsRouteDeps, previous);
  });
}

function makeDrizzleMock(result: unknown) {
  const chain: Record<string, unknown> = {};
  chain.from = () => chain;
  chain.leftJoin = () => chain;
  chain.where = () => chain;
  chain.orderBy = () => chain;
  chain.limit = () => chain;
  chain.get = async () => result;
  chain.all = async () => (Array.isArray(result) ? result : []);
  return {
    select: () => chain,
  };
}

Deno.test(
  "apps routes workspace scope - calls space access for requested detail lookups and returns 404 when the app is missing",
  async () => {
    const getDbSpy = spy(() => makeDrizzleMock(null));
    const requireSpaceAccessSpy = spy(async () => ({
      space: { id: "ws-1" },
      membership: { role: "viewer" },
    }));

    await withAppsDeps(
      {
        getDb: getDbSpy as never,
        requireSpaceAccess: requireSpaceAccessSpy as never,
      },
      async () => {
        const app = createApp(createUser());
        const response = await app.fetch(
          new Request("http://localhost/apps/app-1", {
            headers: {
              "X-Takos-Space-Id": "team-alpha",
            },
          }),
          createMockEnv() as unknown as Env,
          {} as ExecutionContext,
        );

        assertEquals(response.status, 404);
        assertSpyCalls(requireSpaceAccessSpy, 1);
        assertEquals(
          (requireSpaceAccessSpy.calls[0] as any).args[1],
          "team-alpha",
        );
      },
    );
  },
);
