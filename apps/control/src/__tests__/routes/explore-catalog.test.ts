import { Hono } from "hono";
import { isAppError } from "takos-common/errors";
import type { Env, User } from "@/types";
import { createMockEnv } from "../../../test/integration/setup.ts";

import { assertEquals, assertObjectMatch } from "jsr:@std/assert";
import { assertSpyCallArgs, assertSpyCalls, spy } from "jsr:@std/testing/mock";

import explore from "@/routes/explore";
import { exploreRouteDeps } from "../../../../../packages/control/src/server/routes/explore/packages.ts";

type Vars = { user?: User };
type HonoEnv = { Bindings: Env; Variables: Vars };

function createUser(id: string, username: string): User {
  return {
    id,
    email: `${username}@example.com`,
    name: username,
    username,
    bio: null,
    picture: null,
    trust_tier: "normal",
    setup_completed: true,
    created_at: "2026-02-22T00:00:00.000Z",
    updated_at: "2026-02-22T00:00:00.000Z",
  };
}

function createApp(user?: User) {
  const app = new Hono<HonoEnv>();
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
    if (user) c.set("user", user);
    await next();
  });
  app.route("/api", explore);
  return app;
}

Deno.test("GET /explore/catalog - returns 400 when sort is invalid", async () => {
  const originalListCatalogItems = exploreRouteDeps.listCatalogItems;
  const listCatalogItemsSpy = spy(async () => ({
    items: [],
    total: 0,
    has_more: false,
  }));
  exploreRouteDeps.listCatalogItems =
    listCatalogItemsSpy as typeof originalListCatalogItems;

  try {
    const app = createApp();
    const env = createMockEnv() as unknown as Env;

    const response = await app.fetch(
      new Request("https://takos.jp/api/catalog?sort=invalid", {
        headers: { Authorization: "Bearer test" },
      }),
      env,
      {} as ExecutionContext,
    );

    assertEquals(response.status, 400);
    assertObjectMatch(await response.json(), {
      error: {
        code: "BAD_REQUEST",
        message: "Invalid sort",
      },
    });
    assertSpyCalls(listCatalogItemsSpy, 0);
  } finally {
    exploreRouteDeps.listCatalogItems = originalListCatalogItems;
  }
});

Deno.test("GET /explore/catalog - returns 400 for unknown catalog type", async () => {
  const originalListCatalogItems = exploreRouteDeps.listCatalogItems;
  const listCatalogItemsSpy = spy(async () => ({
    items: [],
    total: 0,
    has_more: false,
  }));
  exploreRouteDeps.listCatalogItems =
    listCatalogItemsSpy as typeof originalListCatalogItems;

  try {
    const app = createApp();
    const env = createMockEnv() as unknown as Env;

    const response = await app.fetch(
      new Request("https://takos.jp/api/catalog?type=legacy", {
        headers: { Authorization: "Bearer test" },
      }),
      env,
      {} as ExecutionContext,
    );

    assertEquals(response.status, 400);
    assertObjectMatch(await response.json(), {
      error: {
        code: "BAD_REQUEST",
        message: "Invalid type",
      },
    });
    assertSpyCalls(listCatalogItemsSpy, 0);
  } finally {
    exploreRouteDeps.listCatalogItems = originalListCatalogItems;
  }
});

Deno.test("GET /explore/catalog - returns 401 when space_id is specified without auth", async () => {
  const originalListCatalogItems = exploreRouteDeps.listCatalogItems;
  const listCatalogItemsSpy = spy(async () => ({
    items: [],
    total: 0,
    has_more: false,
  }));
  exploreRouteDeps.listCatalogItems =
    listCatalogItemsSpy as typeof originalListCatalogItems;

  try {
    const app = createApp();
    const env = createMockEnv() as unknown as Env;

    const response = await app.fetch(
      new Request("https://takos.jp/api/catalog?space_id=me", {
        headers: { Authorization: "Bearer test" },
      }),
      env,
      {} as ExecutionContext,
    );

    assertEquals(response.status, 401);
    assertObjectMatch(await response.json(), {
      error: {
        code: "UNAUTHORIZED",
        message: "Authentication required for space_id",
      },
    });
    assertSpyCalls(listCatalogItemsSpy, 0);
  } finally {
    exploreRouteDeps.listCatalogItems = originalListCatalogItems;
  }
});

Deno.test("GET /explore/catalog - calls listCatalogItems with normalized query options", async () => {
  const originalListCatalogItems = exploreRouteDeps.listCatalogItems;
  const listCatalogItemsSpy = spy(async () => ({
    items: [],
    total: 0,
    has_more: false,
  }));
  exploreRouteDeps.listCatalogItems =
    listCatalogItemsSpy as typeof originalListCatalogItems;

  try {
    const app = createApp(createUser("user-1", "alice"));
    const env = createMockEnv() as unknown as Env;

    const response = await app.fetch(
      new Request(
        "https://takos.jp/api/catalog?q=runtime&sort=downloads&type=deployable-app&limit=10&offset=20&category=app&language=typescript&license=mit&since=2026-02-01&tags=cli,tools&certified_only=true",
        { headers: { Authorization: "Bearer test" } },
      ),
      env,
      {} as ExecutionContext,
    );

    assertEquals(response.status, 200);
    assertSpyCalls(listCatalogItemsSpy, 1);
    assertSpyCallArgs(listCatalogItemsSpy, 0, [
      env.DB,
      {
        sort: "downloads",
        type: "deployable-app",
        limit: 10,
        offset: 20,
        searchQuery: "runtime",
        category: "app",
        language: "typescript",
        license: "mit",
        since: "2026-02-01T00:00:00.000Z",
        tagsRaw: "cli,tools",
        certifiedOnly: true,
        spaceId: undefined,
        userId: "user-1",
        gitObjects: env.GIT_OBJECTS,
      },
    ]);

    assertObjectMatch(await response.json(), {
      items: [],
      total: 0,
      has_more: false,
    });
  } finally {
    exploreRouteDeps.listCatalogItems = originalListCatalogItems;
  }
});
