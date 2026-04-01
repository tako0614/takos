import { Hono } from "hono";
import { assert, assertEquals } from "jsr:@std/assert";

import { createMockEnv } from "../../../test/integration/setup.ts";
import { createCustomDomainsRoute } from "@/routes/custom-domains";
import { CustomDomainError } from "@/services/platform/custom-domains";
import type { Env, User } from "@/types";

type RouteDeps = Parameters<typeof createCustomDomainsRoute>[0];

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

function createRouteDeps(overrides: Partial<RouteDeps> = {}): RouteDeps {
  return {
    addCustomDomain: async () =>
      ({ status: 201, body: { domain: "unused" } }) as never,
    deleteCustomDomain: async () => ({ success: true }) as never,
    getCustomDomainDetails: async () =>
      ({ id: "d-1", domain: "example.com" }) as never,
    listCustomDomains: async () =>
      ({ domains: [{ id: "d-1", domain: "example.com" }] }) as never,
    refreshSslStatus: async () => ({ ssl_status: "active" }) as never,
    verifyCustomDomain: async () =>
      ({ status: 200, body: { verified: true } }) as never,
    ...overrides,
  } as RouteDeps;
}

function createApp(user: User, deps?: RouteDeps) {
  const app = new Hono<{ Bindings: Env; Variables: { user: User } }>();
  app.use("*", async (c, next) => {
    c.set("user", user);
    await next();
  });
  app.route("/api", createCustomDomainsRoute(deps));
  return app;
}

Deno.test("custom-domains routes - GET /api/services/:id/custom-domains - returns list of custom domains", async () => {
  const env = createMockEnv();
  const app = createApp(createUser(), createRouteDeps());

  const res = await app.fetch(
    new Request("http://localhost/api/services/w-1/custom-domains"),
    env as unknown as Env,
    {} as ExecutionContext,
  );

  assertEquals(res.status, 200);
  const json = await res.json() as Record<string, unknown>;
  assert("domains" in json);
});

Deno.test("custom-domains routes - GET /api/services/:id/custom-domains - returns error on CustomDomainError", async () => {
  const env = createMockEnv();
  const app = createApp(
    createUser(),
    createRouteDeps({
      listCustomDomains: async () => {
        throw new CustomDomainError("Not found", 404);
      },
    }),
  );

  const res = await app.fetch(
    new Request("http://localhost/api/services/w-1/custom-domains"),
    env as unknown as Env,
    {} as ExecutionContext,
  );

  assertEquals(res.status, 404);
});

Deno.test("custom-domains routes - GET /api/services/:id/custom-domains - returns 500 on unexpected error", async () => {
  const env = createMockEnv();
  const app = createApp(
    createUser(),
    createRouteDeps({
      listCustomDomains: async () => {
        throw new Error("Unexpected");
      },
    }),
  );

  const res = await app.fetch(
    new Request("http://localhost/api/services/w-1/custom-domains"),
    env as unknown as Env,
    {} as ExecutionContext,
  );

  assertEquals(res.status, 500);
});

Deno.test("custom-domains routes - POST /api/services/:id/custom-domains - adds a custom domain", async () => {
  const env = createMockEnv();
  const app = createApp(
    createUser(),
    createRouteDeps({
      addCustomDomain: async () =>
        ({
          status: 201,
          body: { domain: "new.example.com" },
        }) as never,
    }),
  );

  const res = await app.fetch(
    new Request("http://localhost/api/services/w-1/custom-domains", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ domain: "new.example.com" }),
    }),
    env as unknown as Env,
    {} as ExecutionContext,
  );

  assertEquals(res.status, 201);
});

Deno.test("custom-domains routes - POST /api/services/:id/custom-domains - rejects missing domain field", async () => {
  const env = createMockEnv();
  const app = createApp(createUser(), createRouteDeps());

  const res = await app.fetch(
    new Request("http://localhost/api/services/w-1/custom-domains", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    }),
    env as unknown as Env,
    {} as ExecutionContext,
  );

  assertEquals(res.status, 422);
});

Deno.test("custom-domains routes - POST /api/services/:id/custom-domains/:domainId/verify - verifies a custom domain", async () => {
  const env = createMockEnv();
  const app = createApp(createUser(), createRouteDeps());

  const res = await app.fetch(
    new Request("http://localhost/api/services/w-1/custom-domains/d-1/verify", {
      method: "POST",
    }),
    env as unknown as Env,
    {} as ExecutionContext,
  );

  assertEquals(res.status, 200);
});

Deno.test("custom-domains routes - GET /api/services/:id/custom-domains/:domainId - returns domain details", async () => {
  const env = createMockEnv();
  const app = createApp(createUser(), createRouteDeps());

  const res = await app.fetch(
    new Request("http://localhost/api/services/w-1/custom-domains/d-1"),
    env as unknown as Env,
    {} as ExecutionContext,
  );

  assertEquals(res.status, 200);
});

Deno.test("custom-domains routes - DELETE /api/services/:id/custom-domains/:domainId - deletes a custom domain", async () => {
  const env = createMockEnv();
  const app = createApp(createUser(), createRouteDeps());

  const res = await app.fetch(
    new Request("http://localhost/api/services/w-1/custom-domains/d-1", {
      method: "DELETE",
    }),
    env as unknown as Env,
    {} as ExecutionContext,
  );

  assertEquals(res.status, 200);
});

Deno.test("custom-domains routes - POST /api/services/:id/custom-domains/:domainId/refresh-ssl - refreshes SSL status", async () => {
  const env = createMockEnv();
  const app = createApp(createUser(), createRouteDeps());

  const res = await app.fetch(
    new Request(
      "http://localhost/api/services/w-1/custom-domains/d-1/refresh-ssl",
      {
        method: "POST",
      },
    ),
    env as unknown as Env,
    {} as ExecutionContext,
  );

  assertEquals(res.status, 200);
});
