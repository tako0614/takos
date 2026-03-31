import { Hono } from "hono";

import { assertEquals, assertObjectMatch } from "jsr:@std/assert";

import type { Env } from "@/types";
import { validateApiOpaqueRouteParams } from "@/server/middleware/param-validation.ts";

type TestEnv = {
  Bindings: Env;
  Variables: { user?: { id: string } };
};

function createApp() {
  const app = new Hono<TestEnv>();
  app.onError((error) => {
    const statusCode =
      typeof (error as unknown as { statusCode?: unknown }).statusCode ===
          "number"
        ? (error as unknown as { statusCode: number }).statusCode
        : 500;
    const code =
      typeof (error as unknown as { code?: unknown }).code === "string"
        ? (error as unknown as { code: string }).code
        : "INTERNAL_ERROR";
    return new Response(
      JSON.stringify({ error: error.message, code }),
      {
        status: statusCode,
        headers: { "Content-Type": "application/json" },
      },
    );
  });
  app.use("/repos/:repoId", validateApiOpaqueRouteParams);
  app.use("/repos/:repoId/*", validateApiOpaqueRouteParams);
  app.use("/resources/:id/bind/:serviceId", validateApiOpaqueRouteParams);
  app.use("/spaces/:spaceId", validateApiOpaqueRouteParams);
  app.use("/spaces/:spaceId/*", validateApiOpaqueRouteParams);
  app.use("/users/:username", validateApiOpaqueRouteParams);
  app.use("/users/:username/*", validateApiOpaqueRouteParams);
  app.get(
    "/repos/:repoId",
    (c) => c.json({ ok: true, repoId: c.req.param("repoId") }),
  );
  app.get("/resources/:id/bind/:serviceId", (c) =>
    c.json({
      ok: true,
      id: c.req.param("id"),
      serviceId: c.req.param("serviceId"),
    }));
  app.get(
    "/spaces/:spaceId",
    (c) => c.json({ ok: true, spaceId: c.req.param("spaceId") }),
  );
  app.get(
    "/users/:username",
    (c) => c.json({ ok: true, username: c.req.param("username") }),
  );
  return app;
}

const mockEnv = {} as Env;

Deno.test("validateApiOpaqueRouteParams allows valid opaque id params", async () => {
  const app = createApp();

  const response = await app.fetch(
    new Request("https://takos.jp/repos/repo-123_abc"),
    mockEnv,
    {} as ExecutionContext,
  );

  assertEquals(response.status, 200);
  assertEquals(await response.json(), { ok: true, repoId: "repo-123_abc" });
});

Deno.test("validateApiOpaqueRouteParams rejects malformed opaque id params with 400", async () => {
  const app = createApp();

  const response = await app.fetch(
    new Request("https://takos.jp/repos/repo.invalid"),
    mockEnv,
    {} as ExecutionContext,
  );

  assertEquals(response.status, 400);
  assertObjectMatch(await response.json(), {
    error: "Invalid route parameter: repoId",
    code: "BAD_REQUEST",
  });
});

Deno.test("validateApiOpaqueRouteParams does not validate non-id params as opaque ids", async () => {
  const app = createApp();

  const response = await app.fetch(
    new Request("https://takos.jp/users/alice.example"),
    mockEnv,
    {} as ExecutionContext,
  );

  assertEquals(response.status, 200);
  assertEquals(await response.json(), { ok: true, username: "alice.example" });
});

Deno.test("validateApiOpaqueRouteParams rejects malformed serviceId params with 400", async () => {
  const app = createApp();

  const response = await app.fetch(
    new Request("https://takos.jp/resources/res-123/bind/service.invalid"),
    mockEnv,
    {} as ExecutionContext,
  );

  assertEquals(response.status, 400);
  assertObjectMatch(await response.json(), {
    error: "Invalid route parameter: serviceId",
    code: "BAD_REQUEST",
  });
});

Deno.test("validateApiOpaqueRouteParams allows personal workspace alias for spaceId params", async () => {
  const app = createApp();

  const response = await app.fetch(
    new Request("https://takos.jp/spaces/me"),
    mockEnv,
    {} as ExecutionContext,
  );

  assertEquals(response.status, 200);
  assertEquals(await response.json(), { ok: true, spaceId: "me" });
});

Deno.test("validateApiOpaqueRouteParams allows workspace slug values for spaceId params", async () => {
  const app = createApp();

  const response = await app.fetch(
    new Request("https://takos.jp/spaces/team-alpha"),
    mockEnv,
    {} as ExecutionContext,
  );

  assertEquals(response.status, 200);
  assertEquals(await response.json(), { ok: true, spaceId: "team-alpha" });
});
