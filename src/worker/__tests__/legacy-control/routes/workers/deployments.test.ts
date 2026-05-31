import { Hono } from "hono";
import type { User } from "@/types";
import type { AuthenticatedRouteEnv } from "@/routes/shared/helpers";
import { createMockEnv } from "../../../../test/integration/setup.ts";

import { assertEquals, assertObjectMatch } from "@std/assert";
import { spy } from "@std/testing/mock";
import { isAppError } from "@takos/worker-platform-utils/errors";
import { asTestClassMock, asyncNoopDep, noopDep } from "@test/dep-stubs";

type LooseAsyncFn = (...args: unknown[]) => Promise<unknown>;
type LooseFn = (...args: unknown[]) => unknown;

const mocks: {
  getServiceForUser: LooseAsyncFn;
  getServiceForUserWithRole: LooseAsyncFn;
  DeploymentService: LooseFn;
} = {
  getServiceForUser: asyncNoopDep(
    "workersDeploymentsRouteDeps.getServiceForUser",
  ),
  getServiceForUserWithRole: asyncNoopDep(
    "workersDeploymentsRouteDeps.getServiceForUserWithRole",
  ),
  DeploymentService: noopDep("workersDeploymentsRouteDeps.DeploymentService"),
};

// [Deno] vi.mock removed - manually stub imports from '@/services/platform/workers'
// [Deno] vi.mock removed - manually stub imports from '@/services/deployment/index'
import workersDeployments from "@/routes/workers/deployments";
import { workersDeploymentsRouteDeps } from "@/routes/workers/deployments";

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

function createApp(user: User): Hono<AuthenticatedRouteEnv> {
  const app = new Hono<AuthenticatedRouteEnv>();
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
  app.route("/api/services", workersDeployments);
  return app;
}

type DeploymentServiceLike = ReturnType<
  typeof workersDeploymentsRouteDeps.createDeploymentService
>;
type LooseDeploymentServiceMethod =
  & ((...args: unknown[]) => unknown)
  & { calls?: Array<{ args: unknown[] }> };
type DeploymentServiceMock =
  & {
    [K in keyof DeploymentServiceLike]: LooseDeploymentServiceMethod;
  }
  & {
    // properties the route doesn't use but DeploymentService declares;
    // present here so the mock is structurally assignable through a
    // single cast at the dep-wiring site.
    encryptionKey?: unknown;
    env?: unknown;
  };

// `DeploymentService` declares private members which a structural mock
// cannot satisfy. `asTestClassMock` wraps the partial in a throwing
// proxy that satisfies the full surface; the single internal cast in
// the helper replaces what would otherwise be `as any` here.
function installDeploymentServiceMock(service: DeploymentServiceMock) {
  const wrapped = asTestClassMock<DeploymentServiceLike, DeploymentServiceMock>(
    service,
    "DeploymentService",
  );
  workersDeploymentsRouteDeps.createDeploymentService = () => wrapped;
}

function createDeploymentServiceMock(
  overrides: Partial<DeploymentServiceMock> = {},
): DeploymentServiceMock {
  const base = {
    createDeployment: spy(
      noopDep<LooseFn>("DeploymentService.createDeployment"),
    ),
    executeDeployment: noopDep<LooseFn>("DeploymentService.executeDeployment"),
    getDeploymentHistory: async () => [],
    rollback: noopDep<LooseFn>("DeploymentService.rollback"),
    rollbackWorker: noopDep<LooseFn>("DeploymentService.rollbackWorker"),
    getDeploymentById: noopDep<LooseFn>("DeploymentService.getDeploymentById"),
    getDeploymentEvents: async () => [],
    getMaskedEnvVars: async () => ({}),
    getBindings: async () => [],
    encryptionKey: undefined,
    env: undefined,
    ...overrides,
  };
  return base as DeploymentServiceMock;
}

Deno.test("services deployments routes - passes target configuration into deployment creation without public backend", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const service = createDeploymentServiceMock({
    createDeployment: spy(async () => ({
      id: "dep-1",
      version: 1,
      status: "pending",
      deploy_state: "queued",
      backend_name: "oci",
      target_json: JSON.stringify({
        route_ref: "takos-worker",
        endpoint: {
          kind: "http-url",
          base_url: "https://worker.example.test",
        },
        artifact: {
          image_ref: "ghcr.io/takos/worker:latest",
          exposed_port: 8080,
        },
      }),
      backend_state_json: "{}",
      routing_status: "active",
      routing_weight: 100,
      created_at: "2026-03-22T00:00:00.000Z",
    })),
  });
  mocks.DeploymentService = () => service;
  mocks.getServiceForUserWithRole = async () => ({
    id: "worker-1",
    space_id: "space-1",
  });
  workersDeploymentsRouteDeps.getServiceForUserWithRole = mocks
    .getServiceForUserWithRole as typeof workersDeploymentsRouteDeps.getServiceForUserWithRole;
  installDeploymentServiceMock(service);
  workersDeploymentsRouteDeps.getServiceForUserWithRole = mocks
    .getServiceForUserWithRole as typeof workersDeploymentsRouteDeps.getServiceForUserWithRole;
  installDeploymentServiceMock(service);

  const app = createApp(createUser());
  const env = createMockEnv({
    DEPLOY_QUEUE: { send: async () => undefined },
  });
  const response = await app.fetch(
    new Request("http://localhost/api/services/worker-1/deployments", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        bundle: "export default {}",
        target: {
          route_ref: "takos-worker",
          endpoint: {
            kind: "http-url",
            base_url: "https://worker.example.test",
          },
          artifact: {
            image_ref: "ghcr.io/takos/worker:latest",
            exposed_port: 8080,
          },
        },
      }),
    }),
    env,
    {} as ExecutionContext,
  );

  assertEquals(response.status, 201);
  const json = await response.json() as { deployment: Record<string, unknown> };
  assertObjectMatch(json, {
    deployment: {
      id: "dep-1",
      version: 1,
      target: {
        route_ref: "takos-worker",
        endpoint: {
          kind: "http-url",
          base_url: "https://worker.example.test",
        },
        artifact: {
          image_ref: "ghcr.io/takos/worker:latest",
          exposed_port: 8080,
        },
      },
    },
  });
  assertEquals("backend" in json.deployment, false);
  assertEquals("backend_name" in json.deployment, false);
  assertEquals("backendStateJson" in json.deployment, false);
  assertEquals("backend_state_json" in json.deployment, false);
  assertEquals("backend" in json.deployment, false);
  assertEquals("backendName" in json.deployment, false);
  assertEquals("backend_name" in json.deployment, false);
  assertEquals("backendStateJson" in json.deployment, false);
  assertEquals("backend_state_json" in json.deployment, false);
  assertEquals("backend" in json.deployment, false);
  assertEquals("backendName" in json.deployment, false);
  assertEquals("backend_name" in json.deployment, false);
  assertEquals("backendStateJson" in json.deployment, false);
  assertEquals("backend_state_json" in json.deployment, false);
  assertObjectMatch(
    service.createDeployment.calls?.[0]?.args[0] as Record<string, unknown>,
    {
      serviceId: "worker-1",
      spaceId: "space-1",
      userId: "user-1",
      target: {
        route_ref: "takos-worker",
        endpoint: {
          kind: "http-url",
          base_url: "https://worker.example.test",
        },
        artifact: {
          image_ref: "ghcr.io/takos/worker:latest",
          exposed_port: 8080,
        },
      },
    },
  );
  assertEquals(
    "backend" in
      (service.createDeployment.calls?.[0]?.args[0] as Record<string, unknown>),
    false,
  );
});
Deno.test("services deployments routes - rejects backend input on create", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const service = createDeploymentServiceMock();
  mocks.DeploymentService = () => service;
  mocks.getServiceForUserWithRole = async () => ({
    id: "worker-1",
    space_id: "space-1",
  });
  workersDeploymentsRouteDeps.getServiceForUserWithRole = mocks
    .getServiceForUserWithRole as typeof workersDeploymentsRouteDeps.getServiceForUserWithRole;
  installDeploymentServiceMock(service);

  const app = createApp(createUser());
  const env = createMockEnv();
  const response = await app.fetch(
    new Request("http://localhost/api/services/worker-1/deployments", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        bundle: "export default {}",
        backend: { name: "oci" },
      }),
    }),
    env,
    {} as ExecutionContext,
  );

  assertEquals(response.status, 400);
  assertObjectMatch(await response.json(), {
    error: {
      code: "VALIDATION_ERROR",
      message: "Request validation failed",
    },
  });
  assertEquals(service.createDeployment.calls?.length ?? 0, 0);
});

Deno.test("services deployments routes - rounds fractional canary weight", async () => {
  const service = createDeploymentServiceMock({
    createDeployment: spy(async () => ({
      id: "dep-canary",
      version: 1,
      status: "pending",
      deploy_state: "queued",
      backend_name: "workers-dispatch",
      target_json: "{}",
      backend_state_json: "{}",
      routing_status: "canary",
      routing_weight: 2,
      created_at: "2026-03-22T00:00:00.000Z",
    })),
  });
  mocks.getServiceForUserWithRole = async () => ({
    id: "worker-1",
    space_id: "space-1",
  });
  workersDeploymentsRouteDeps.getServiceForUserWithRole = mocks
    .getServiceForUserWithRole as typeof workersDeploymentsRouteDeps.getServiceForUserWithRole;
  installDeploymentServiceMock(service);

  const app = createApp(createUser());
  const env = createMockEnv({
    DEPLOY_QUEUE: { send: async () => undefined },
  });
  const response = await app.fetch(
    new Request("http://localhost/api/services/worker-1/deployments", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        bundle: "export default {}",
        strategy: "canary",
        canary_weight: 1.9,
      }),
    }),
    env,
    {} as ExecutionContext,
  );

  assertEquals(response.status, 201);
  assertObjectMatch(
    service.createDeployment.calls?.[0]?.args[0] as Record<string, unknown>,
    {
      strategy: "canary",
      canaryWeight: 2,
    },
  );
});
Deno.test("services deployments routes - includes generic target and hides backend in deployment history responses", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const service = createDeploymentServiceMock({
    getDeploymentHistory: async () => [
      {
        id: "dep-oci",
        version: 3,
        status: "success",
        deploy_state: "completed",
        artifact_ref: "artifact-1",
        routing_status: "active",
        routing_weight: 100,
        bundle_hash: "abc123",
        bundle_size: 1234,
        backend_name: "oci",
        target_json: JSON.stringify({
          route_ref: "takos-worker",
          endpoint: {
            kind: "http-url",
            base_url: "https://worker.example.test",
          },
        }),
        backend_state_json: "{}",
        deployed_by: "user-1",
        deploy_message: "deploy to oci",
        created_at: "2026-03-22T00:00:00.000Z",
        completed_at: "2026-03-22T00:00:10.000Z",
        step_error: null,
      },
    ],
  });
  mocks.DeploymentService = () => service;
  mocks.getServiceForUser = async () => ({
    id: "worker-1",
    space_id: "space-1",
  });
  workersDeploymentsRouteDeps.getServiceForUser = mocks
    .getServiceForUser as typeof workersDeploymentsRouteDeps.getServiceForUser;
  installDeploymentServiceMock(service);
  workersDeploymentsRouteDeps.getServiceForUser = mocks
    .getServiceForUser as typeof workersDeploymentsRouteDeps.getServiceForUser;
  installDeploymentServiceMock(service);

  const app = createApp(createUser());
  const env = createMockEnv();
  const response = await app.fetch(
    new Request("http://localhost/api/services/worker-1/deployments"),
    env,
    {} as ExecutionContext,
  );

  assertEquals(response.status, 200);
  const json = await response.json() as {
    deployments: Array<Record<string, unknown>>;
  };
  assertObjectMatch(json, {
    deployments: [
      {
        id: "dep-oci",
        target: {
          route_ref: "takos-worker",
          endpoint: {
            kind: "http-url",
            base_url: "https://worker.example.test",
          },
        },
        status: "success",
      },
    ],
  });
  assertEquals("backend" in json.deployments[0], false);
  assertEquals("backendName" in json.deployments[0], false);
  assertEquals("backend_name" in json.deployments[0], false);
  assertEquals("backendStateJson" in json.deployments[0], false);
  assertEquals("backend_state_json" in json.deployments[0], false);
  assertEquals("backend" in json.deployments[0], false);
  assertEquals("backendName" in json.deployments[0], false);
  assertEquals("backend_name" in json.deployments[0], false);
  assertEquals("backendStateJson" in json.deployments[0], false);
  assertEquals("backend_state_json" in json.deployments[0], false);
});
Deno.test("services deployments routes - hides backend on rollback responses", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const service = createDeploymentServiceMock({
    rollback: async () => ({
      id: "dep-rb",
      version: 2,
      backend_name: "oci",
      target_json: JSON.stringify({
        route_ref: "takos-worker",
        endpoint: {
          kind: "service-ref",
          ref: "takos-worker",
        },
      }),
      backend_state_json: "{}",
      routing_status: "rollback",
      routing_weight: 100,
    }),
  });
  mocks.DeploymentService = () => service;
  mocks.getServiceForUserWithRole = async () => ({
    id: "worker-1",
    space_id: "space-1",
  });
  workersDeploymentsRouteDeps.getServiceForUserWithRole = mocks
    .getServiceForUserWithRole as typeof workersDeploymentsRouteDeps.getServiceForUserWithRole;
  installDeploymentServiceMock(service);
  workersDeploymentsRouteDeps.getServiceForUserWithRole = mocks
    .getServiceForUserWithRole as typeof workersDeploymentsRouteDeps.getServiceForUserWithRole;
  installDeploymentServiceMock(service);

  const app = createApp(createUser());
  const env = createMockEnv();
  const response = await app.fetch(
    new Request("http://localhost/api/services/worker-1/deployments/rollback", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ target_version: 1 }),
    }),
    env,
    {} as ExecutionContext,
  );

  assertEquals(response.status, 200);
  const json = await response.json() as {
    success: boolean;
    deployment: Record<string, unknown>;
  };
  await assertEquals(json, {
    success: true,
    deployment: {
      id: "dep-rb",
      version: 2,
      target: {
        route_ref: "takos-worker",
        endpoint: {
          kind: "service-ref",
          ref: "takos-worker",
        },
      },
      routing_status: "rollback",
      routing_weight: 100,
    },
  });
  assertEquals("backend" in json.deployment, false);
  assertEquals("backend_name" in json.deployment, false);
  assertEquals("backendStateJson" in json.deployment, false);
  assertEquals("backend_state_json" in json.deployment, false);
  assertEquals("backend" in json.deployment, false);
  assertEquals("backendName" in json.deployment, false);
  assertEquals("backend_name" in json.deployment, false);
  assertEquals("backendStateJson" in json.deployment, false);
  assertEquals("backend_state_json" in json.deployment, false);
});
Deno.test("services deployments routes - returns parsed target and hides backend fields in deployment detail responses", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const service = createDeploymentServiceMock({
    getDeploymentById: async () => ({
      id: "dep-oci",
      service_id: "worker-1",
      backend_name: "oci",
      target_json: JSON.stringify({
        route_ref: "takos-worker",
        endpoint: {
          kind: "http-url",
          base_url: "https://worker.example.test",
        },
      }),
      backend_state_json: "{}",
      step_error: null,
    }),
  });
  mocks.DeploymentService = () => service;
  mocks.getServiceForUser = async () => ({
    id: "worker-1",
    space_id: "space-1",
  });
  workersDeploymentsRouteDeps.getServiceForUser = mocks
    .getServiceForUser as typeof workersDeploymentsRouteDeps.getServiceForUser;
  installDeploymentServiceMock(service);
  workersDeploymentsRouteDeps.getServiceForUser = mocks
    .getServiceForUser as typeof workersDeploymentsRouteDeps.getServiceForUser;
  installDeploymentServiceMock(service);

  const app = createApp(createUser());
  const env = createMockEnv();
  const response = await app.fetch(
    new Request("http://localhost/api/services/worker-1/deployments/dep-oci"),
    env,
    {} as ExecutionContext,
  );

  assertEquals(response.status, 200);
  const json = await response.json() as { deployment: Record<string, unknown> };
  assertObjectMatch(json, {
    deployment: {
      id: "dep-oci",
      target: {
        route_ref: "takos-worker",
        endpoint: {
          kind: "http-url",
          base_url: "https://worker.example.test",
        },
      },
      error_message: null,
      env_vars_masked: {},
      bindings: [],
    },
    events: [],
  });
  assertEquals("backend" in json.deployment, false);
  assertEquals("backendName" in json.deployment, false);
  assertEquals("backend_name" in json.deployment, false);
  assertEquals("backendStateJson" in json.deployment, false);
  assertEquals("backend_state_json" in json.deployment, false);
  assertEquals("backend" in json.deployment, false);
  assertEquals("backendName" in json.deployment, false);
  assertEquals("backend_name" in json.deployment, false);
  assertEquals("backendStateJson" in json.deployment, false);
  assertEquals("backend_state_json" in json.deployment, false);
});
