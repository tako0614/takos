import { Hono } from "hono";
import { isAppError } from "takos-common/errors";
import { assertEquals } from "jsr:@std/assert";
import { assertSpyCalls, spy } from "jsr:@std/testing/mock";

import type { Env, User } from "@/types";
import { createMockEnv } from "../../../test/integration/setup.ts";
import { appsRouteDeps, registerAppApiRoutes } from "@/routes/apps";

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
  "apps detail workspace scoping - applies X-Takos-Space-Id to custom app detail lookups",
  async () => {
    const row = {
      id: "app-1",
      name: "custom-app",
      description: "Custom app",
      icon: null,
      appType: "custom",
      takosClientKey: null,
      createdAt: "2026-03-06T00:00:00.000Z",
      updatedAt: "2026-03-06T00:00:00.000Z",
      serviceHostname: "custom-app.example.com",
      serviceStatus: "deployed",
      accountName: "Workspace 1",
      accountSlug: "team-one",
      accountType: "team",
    };

    const getDbSpy = spy(() => makeDrizzleMock(row));
    const requireSpaceAccessSpy = spy(async () => ({
      space: { id: "workspace-1" },
      membership: { role: "viewer" },
    }));

    await withAppsDeps(
      {
        getDb: getDbSpy as never,
        requireSpaceAccess: requireSpaceAccessSpy as never,
      },
      async () => {
        const app = createApp();
        const response = await app.fetch(
          new Request("http://localhost/apps/app-1", {
            headers: {
              "X-Takos-Space-Id": "team-one",
            },
          }),
          createMockEnv() as unknown as Env,
          {} as ExecutionContext,
        );

        assertEquals(response.status, 200);
        assertSpyCalls(requireSpaceAccessSpy, 1);
        assertEquals(
          (requireSpaceAccessSpy.calls[0] as any).args[1],
          "team-one",
        );

        const body = await response.json() as {
          app: { id: string; space_id: string; url: string | null };
        };
        assertEquals(body.app.id, "app-1");
        assertEquals(body.app.space_id, "team-one");
        assertEquals(body.app.url, "https://custom-app.example.com");
      },
    );
  },
);

Deno.test(
  "apps routes - list returns registered apps with custom app labels",
  async () => {
    const rows = [
      {
        id: "app-1",
        name: "custom-app",
        description: "Custom app",
        icon: null,
        appType: "custom",
        accountId: "workspace-1",
        serviceHostname: null,
        serviceStatus: null,
        accountName: "Workspace 1",
        accountSlug: "team-one",
        accountType: "team",
      },
    ];
    const getDbSpy = spy(() => makeDrizzleMock(rows));

    await withAppsDeps(
      {
        getDb: getDbSpy as never,
      },
      async () => {
        const app = createApp();
        const response = await app.fetch(
          new Request("http://localhost/apps"),
          createMockEnv() as unknown as Env,
          {} as ExecutionContext,
        );

        assertEquals(response.status, 200);
        const body = await response.json() as {
          apps: Array<{ id: string; app_type: string }>;
        };
        assertEquals(body.apps.length, 1);
        assertEquals(body.apps[0].id, "app-1");
        assertEquals(body.apps[0].app_type, "custom");
        assertEquals(
          body.apps.some((app) => app.id.startsWith("custom-")),
          false,
        );
      },
    );
  },
);
