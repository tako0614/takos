import { Hono } from "hono";
import { isAppError } from "@takos/worker-platform-utils/errors";
import type { User } from "@/types";
import type { AuthenticatedRouteEnv } from "@/routes/shared/helpers";
import { createMockEnv } from "../../../../test/integration/setup.ts";

import { assertEquals } from "@std/assert";
import {
  assertSpyCallArgs,
  assertSpyCalls,
  type Spy,
  spy,
} from "@std/testing/mock";

import workersSettings from "@/routes/workers/settings";
import { workersSettingsConfigRouteDeps } from "@/routes/workers/settings-config.ts";
import { workersSettingsConsumesRouteDeps } from "@/routes/workers/settings-consumes.ts";
import { workersSettingsEnvVarsRouteDeps } from "@/routes/workers/settings-env-vars.ts";

import { asyncNoopDep, noopDep } from "@test/dep-stubs";

type LooseAsyncFn = (...args: unknown[]) => Promise<unknown>;
type LooseFn = (...args: unknown[]) => unknown;
type SpyAsyncFn = Spy<unknown, unknown[], Promise<unknown>>;

function asSpy(fn: LooseAsyncFn): SpyAsyncFn {
  return fn as SpyAsyncFn;
}

const mocks: {
  getServiceForUser: LooseAsyncFn;
  getServiceForUserWithRole: LooseAsyncFn;
  createDesiredStateService: LooseFn;
  listServiceConsumes: LooseAsyncFn;
  replaceServiceConsumes: LooseAsyncFn;
} = {
  getServiceForUser: asyncNoopDep("settings.getServiceForUser"),
  getServiceForUserWithRole: asyncNoopDep("settings.getServiceForUserWithRole"),
  createDesiredStateService: noopDep("settings.createDesiredStateService"),
  listServiceConsumes: asyncNoopDep("settings.listServiceConsumes"),
  replaceServiceConsumes: asyncNoopDep("settings.replaceServiceConsumes"),
};

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

function bindToDep<T>(mockKey: keyof typeof mocks): T {
  return ((...args: unknown[]) => {
    type AnyFn = (...a: unknown[]) => unknown;
    return (mocks[mockKey] as AnyFn)(...args);
  }) as T;
}

function createApp(user: User): Hono<AuthenticatedRouteEnv> {
  const app = new Hono<AuthenticatedRouteEnv>();

  workersSettingsConfigRouteDeps.getServiceForUser = bindToDep<
    typeof workersSettingsConfigRouteDeps.getServiceForUser
  >("getServiceForUser");
  workersSettingsConfigRouteDeps.getServiceForUserWithRole = bindToDep<
    typeof workersSettingsConfigRouteDeps.getServiceForUserWithRole
  >("getServiceForUserWithRole");
  workersSettingsConfigRouteDeps.createDesiredStateService = bindToDep<
    typeof workersSettingsConfigRouteDeps.createDesiredStateService
  >("createDesiredStateService");

  workersSettingsEnvVarsRouteDeps.getServiceForUser = bindToDep<
    typeof workersSettingsEnvVarsRouteDeps.getServiceForUser
  >("getServiceForUser");
  workersSettingsEnvVarsRouteDeps.getServiceForUserWithRole = bindToDep<
    typeof workersSettingsEnvVarsRouteDeps.getServiceForUserWithRole
  >("getServiceForUserWithRole");
  workersSettingsEnvVarsRouteDeps.createDesiredStateService = bindToDep<
    typeof workersSettingsEnvVarsRouteDeps.createDesiredStateService
  >("createDesiredStateService");

  workersSettingsConsumesRouteDeps.getServiceForUser = bindToDep<
    typeof workersSettingsConsumesRouteDeps.getServiceForUser
  >("getServiceForUser");
  workersSettingsConsumesRouteDeps.getServiceForUserWithRole = bindToDep<
    typeof workersSettingsConsumesRouteDeps.getServiceForUserWithRole
  >("getServiceForUserWithRole");
  workersSettingsConsumesRouteDeps.listServiceConsumes = bindToDep<
    typeof workersSettingsConsumesRouteDeps.listServiceConsumes
  >("listServiceConsumes");
  workersSettingsConsumesRouteDeps.replaceServiceConsumes = bindToDep<
    typeof workersSettingsConsumesRouteDeps.replaceServiceConsumes
  >("replaceServiceConsumes");

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
  app.route("/api/services", workersSettings);
  return app;
}

Deno.test("services settings route - reads runtime config from desired state", async () => {
  const desiredState = {
    getRuntimeConfig: spy(async () => ({
      compatibility_date: "2026-03-01",
      compatibility_flags: ["nodejs_compat"],
      limits: { cpu_ms: 50 },
      updated_at: "2026-03-01T00:00:00.000Z",
    })),
  };
  mocks.getServiceForUser = spy(async () => ({
    id: "service-1",
    space_id: "ws-1",
  }));
  mocks.createDesiredStateService = () => desiredState;

  const app = createApp(createUser());
  const env = createMockEnv();
  const response = await app.fetch(
    new Request("http://localhost/api/services/service-1/settings"),
    env,
    {} as ExecutionContext,
  );

  assertEquals(response.status, 200);
  assertEquals(await response.json(), {
    compatibility_date: "2026-03-01",
    compatibility_flags: ["nodejs_compat"],
    limits: { cpu_ms: 50 },
    applies_on_next_deploy: true,
    updated_at: "2026-03-01T00:00:00.000Z",
  });
  assertSpyCallArgs(asSpy(mocks.getServiceForUser), 0, [
    env.DB,
    "service-1",
    "user-1",
  ]);
  assertSpyCallArgs(desiredState.getRuntimeConfig, 0, [
    "ws-1",
    "service-1",
  ]);
});

Deno.test("services settings route - replaces local env vars for the next deployment", async () => {
  const desiredState = {
    replaceLocalEnvVars: spy(async () => undefined),
    listLocalEnvVarSummaries: spy(async () => [
      { name: "API_URL", type: "plain_text" },
      { name: "API_TOKEN", type: "secret_text" },
    ]),
  };
  mocks.getServiceForUserWithRole = spy(async () => ({
    id: "service-1",
    space_id: "ws-1",
  }));
  mocks.createDesiredStateService = () => desiredState;

  const app = createApp(createUser());
  const env = createMockEnv();
  const response = await app.fetch(
    new Request("http://localhost/api/services/service-1/env", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        variables: [
          { name: "API_URL", value: "https://api.example.test" },
          { name: "API_TOKEN", value: "secret", secret: true },
        ],
      }),
    }),
    env,
    {} as ExecutionContext,
  );

  assertEquals(response.status, 200);
  assertEquals(await response.json(), {
    success: true,
    env: [
      { name: "API_URL", type: "plain_text" },
      { name: "API_TOKEN", type: "secret_text" },
    ],
    applies_on_next_deploy: true,
  });
  assertSpyCallArgs(asSpy(mocks.getServiceForUserWithRole), 0, [
    env.DB,
    "service-1",
    "user-1",
    ["owner", "admin", "editor"],
  ]);
  assertSpyCallArgs(desiredState.replaceLocalEnvVars, 0, [{
    spaceId: "ws-1",
    workerId: "service-1",
    variables: [
      {
        name: "API_URL",
        value: "https://api.example.test",
        secret: false,
      },
      {
        name: "API_TOKEN",
        value: "secret",
        secret: true,
      },
    ],
  }]);
  assertSpyCallArgs(desiredState.listLocalEnvVarSummaries, 0, [
    "ws-1",
    "service-1",
  ]);
});

Deno.test("services settings route - replaces consumes as next-deploy desired state", async () => {
  mocks.getServiceForUserWithRole = spy(async () => ({
    id: "service-1",
    space_id: "ws-1",
    slug: "api",
    service_name: "fallback-api",
  }));
  mocks.replaceServiceConsumes = spy(async () => [
    {
      publication: "auth.default",
      as: "auth",
      request: { scopes: ["auth:read"] },
      inject: { env: { url: "PUBLIC_URL" } },
    },
  ]);

  const app = createApp(createUser());
  const env = createMockEnv();
  const response = await app.fetch(
    new Request("http://localhost/api/services/service-1/consumes", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        consumes: [
          {
            publication: "auth.default",
            as: "auth",
            request: { scopes: ["auth:read"] },
            inject: { env: { url: "PUBLIC_URL" } },
          },
        ],
      }),
    }),
    env,
    {} as ExecutionContext,
  );

  assertEquals(response.status, 200);
  assertEquals(await response.json(), {
    success: true,
    consumes: [
      {
        publication: "auth.default",
        as: "auth",
        request: { scopes: ["auth:read"] },
        inject: { env: { url: "PUBLIC_URL" } },
      },
    ],
    applies_on_next_deploy: true,
  });
  assertSpyCallArgs(asSpy(mocks.getServiceForUserWithRole), 0, [
    env.DB,
    "service-1",
    "user-1",
    ["owner", "admin"],
  ]);
  assertSpyCallArgs(asSpy(mocks.replaceServiceConsumes), 0, [
    env,
    {
      spaceId: "ws-1",
      serviceId: "service-1",
      serviceName: "api",
      consumerGroupId: null,
      consumes: [
        {
          publication: "auth.default",
          as: "auth",
          request: { scopes: ["auth:read"] },
          inject: { env: { url: "PUBLIC_URL" } },
        },
      ],
    },
  ]);
  assertSpyCalls(asSpy(mocks.replaceServiceConsumes), 1);
});
