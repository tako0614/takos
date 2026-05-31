import { Hono } from "hono";
import { getTableName } from "drizzle-orm";
import { isAppError } from "@takos/worker-platform-utils/errors";
import { assertEquals } from "@std/assert";
import { assertSpyCalls, spy } from "@std/testing/mock";

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

function makeAppInventoryDbMock(params: {
  publicationRows?: unknown[];
}) {
  let tableName = "";
  const chain: Record<string, unknown> = {};
  chain.from = (table: unknown) => {
    tableName = getTableName(table as never);
    return chain;
  };
  chain.leftJoin = () => chain;
  chain.where = () => chain;
  chain.orderBy = () => chain;
  chain.limit = () => chain;
  chain.get = async () =>
    tableName === "publications" ? params.publicationRows?.[0] ?? null : null;
  chain.all = async () =>
    tableName === "publications" ? params.publicationRows ?? [] : [];
  return {
    select: () => chain,
  };
}

function uiSurfaceRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "pub-docs-ui",
    name: "docs-ui",
    groupId: "group-docs",
    sourceType: "manifest",
    publicationType: "UiSurface",
    specJson: JSON.stringify({
      name: "docs-ui",
      publisher: "web",
      type: "UiSurface",
      display: {
        title: "Docs",
        description: "Docs app",
        icon: "D",
        category: "office",
        sortOrder: 10,
      },
      spec: {},
    }),
    resolvedJson: JSON.stringify({ url: "https://docs.example.com/" }),
    serviceConfig: null,
    serviceHostname: "docs.example.com",
    serviceStatus: "deployed",
    accountName: "Workspace 1",
    accountSlug: "team-one",
    accountType: "team",
    createdAt: "2026-03-06T00:00:00.000Z",
    updatedAt: "2026-03-06T00:00:00.000Z",
    ...overrides,
  };
}

Deno.test(
  "apps detail workspace scoping - does not expose legacy custom app rows",
  async () => {
    const row = {
      id: "app-1",
      name: "custom-app",
      description: "Custom app",
      icon: null,
      appType: "custom",
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
          createMockEnv(),
          {} as ExecutionContext,
        );

        assertEquals(response.status, 404);
        assertSpyCalls(requireSpaceAccessSpy, 1);
      },
    );
  },
);

Deno.test(
  "apps routes - list ignores legacy app rows",
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
          createMockEnv(),
          {} as ExecutionContext,
        );

        assertEquals(response.status, 200);
        const body = await response.json() as { apps: unknown[] };
        assertEquals(body.apps.length, 0);
      },
    );
  },
);

Deno.test(
  "apps routes - list returns manifest UiSurface publications as installed apps",
  async () => {
    const hidden = uiSurfaceRow({
      id: "pub-hidden",
      name: "hidden-ui",
      specJson: JSON.stringify({
        name: "hidden-ui",
        publisher: "web",
        type: "UiSurface",
        display: { title: "Hidden" },
        spec: { launcher: false },
      }),
    });
    const getDbSpy = spy(() =>
      makeAppInventoryDbMock({
        publicationRows: [uiSurfaceRow(), hidden],
      })
    );
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
          new Request("http://localhost/apps", {
            headers: { "X-Takos-Space-Id": "team-one" },
          }),
          createMockEnv(),
          {} as ExecutionContext,
        );

        assertEquals(response.status, 200);
        assertSpyCalls(requireSpaceAccessSpy, 1);
        const body = await response.json() as {
          apps: Array<{
            id: string;
            name: string;
            source_type: string;
            category: string | null;
            url: string | null;
          }>;
        };
        assertEquals(body.apps.length, 1);
        assertEquals(body.apps[0].id, "pub-docs-ui");
        assertEquals(body.apps[0].name, "Docs");
        assertEquals(body.apps[0].source_type, "manifest");
        assertEquals(body.apps[0].category, "office");
        assertEquals(body.apps[0].url, "https://docs.example.com/");
      },
    );
  },
);

Deno.test(
  "apps routes - detail resolves manifest UiSurface apps by publication id",
  async () => {
    const getDbSpy = spy(() =>
      makeAppInventoryDbMock({
        publicationRows: [uiSurfaceRow()],
      })
    );
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
          new Request("http://localhost/apps/pub-docs-ui", {
            headers: { "X-Takos-Space-Id": "team-one" },
          }),
          createMockEnv(),
          {} as ExecutionContext,
        );

        assertEquals(response.status, 200);
        assertSpyCalls(requireSpaceAccessSpy, 1);
        const body = await response.json() as {
          app: { id: string; source_type: string; url: string | null };
        };
        assertEquals(body.app.id, "pub-docs-ui");
        assertEquals(body.app.source_type, "manifest");
        assertEquals(body.app.url, "https://docs.example.com/");
      },
    );
  },
);

Deno.test(
  "apps routes - manifest UiSurface apps fall back to publisher compute icon",
  async () => {
    const getDbSpy = spy(() =>
      makeAppInventoryDbMock({
        publicationRows: [
          uiSurfaceRow({
            id: "pub-publisher-icon",
            name: "publisher-icon-ui",
            specJson: JSON.stringify({
              name: "publisher-icon-ui",
              publisher: "web",
              type: "UiSurface",
              display: {
                title: "Publisher Icon",
                description: "Uses publisher icon",
                category: "office",
              },
              spec: {},
            }),
            serviceConfig: JSON.stringify({
              managedBy: "group",
              manifestName: "web",
              desiredSpec: {
                icon: "/icons/publisher.png",
              },
            }),
          }),
        ],
      })
    );
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
          new Request("http://localhost/apps", {
            headers: { "X-Takos-Space-Id": "team-one" },
          }),
          createMockEnv(),
          {} as ExecutionContext,
        );

        assertEquals(response.status, 200);
        assertSpyCalls(requireSpaceAccessSpy, 1);
        const body = await response.json() as {
          apps: Array<{ id: string; icon: string }>;
        };
        assertEquals(body.apps.length, 1);
        assertEquals(body.apps[0].id, "pub-publisher-icon");
        assertEquals(
          body.apps[0].icon,
          "https://docs.example.com/icons/publisher.png",
        );
      },
    );
  },
);

Deno.test(
  "apps routes - manifest UiSurface apps are read-only through app mutations",
  async () => {
    const getDbSpy = spy(() =>
      makeAppInventoryDbMock({
        publicationRows: [uiSurfaceRow()],
      })
    );
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
          new Request("http://localhost/apps/pub-docs-ui", {
            method: "PATCH",
            headers: {
              "Content-Type": "application/json",
              "X-Takos-Space-Id": "team-one",
            },
            body: JSON.stringify({ description: "Updated" }),
          }),
          createMockEnv(),
          {} as ExecutionContext,
        );

        assertEquals(response.status, 400);
        assertSpyCalls(requireSpaceAccessSpy, 1);
      },
    );
  },
);
