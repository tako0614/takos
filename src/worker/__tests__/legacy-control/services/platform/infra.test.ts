import type { Env } from "@/types";
import { createMockEnv } from "../../../../test/integration/setup.ts";

import { assert, assertEquals, assertNotEquals } from "@std/assert";
import { assertSpyCalls, spy } from "@std/testing/mock";
import { noopDep } from "@test/dep-stubs";

type AnyMockFn = (...args: never[]) => unknown;

const mocks: {
  getDb: AnyMockFn;
  generateId: () => string;
  now: () => string;
} = {
  getDb: noopDep("infraServiceDeps.getDb"),
  generateId: () => "infra-new",
  now: () => "2026-03-24T00:00:00.000Z",
};

// [Deno] vi.mock removed - manually stub imports from '@/db'
// [Deno] vi.mock removed - manually stub imports from '@/shared/utils'
import {
  buildStoredEndpointForRuntime,
  InfraService,
  infraServiceDeps,
} from "@/services/platform/infra";
import { asTestDatabase } from "@test/db-stubs";

const originalInfraServiceDeps = { ...infraServiceDeps };

function withInfraDeps(drizzle: ReturnType<typeof createDrizzleMock>) {
  const wrappedDb = asTestDatabase(drizzle);
  infraServiceDeps.getDb =
    ((..._args: Parameters<typeof infraServiceDeps.getDb>) =>
      wrappedDb) as typeof infraServiceDeps.getDb;
  infraServiceDeps.generateId = mocks
    .generateId as typeof infraServiceDeps.generateId;
  infraServiceDeps.now = mocks.now as typeof infraServiceDeps.now;
}

function restoreInfraDeps() {
  Object.assign(infraServiceDeps, originalInfraServiceDeps);
}

type MockFn = (...args: unknown[]) => unknown;

interface DrizzleMockApi {
  get: MockFn;
  all: MockFn;
  run: MockFn;
}

interface DrizzleMockChain {
  from(): DrizzleMockChain;
  where(): DrizzleMockChain;
  set(): DrizzleMockChain;
  values(): DrizzleMockChain;
  orderBy(): DrizzleMockChain;
  get: MockFn;
  all: MockFn;
  run: MockFn;
}

function createDrizzleMock() {
  const api: DrizzleMockApi = {
    get: async () => undefined,
    all: async () => undefined,
    run: async () => undefined,
  };
  const chain: DrizzleMockChain = {
    from() {
      return chain;
    },
    where() {
      return chain;
    },
    set() {
      return chain;
    },
    values() {
      return chain;
    },
    orderBy() {
      return chain;
    },
    get: (...args: unknown[]) => api.get(...args),
    all: (...args: unknown[]) => api.all(...args),
    run: (...args: unknown[]) => api.run(...args),
  };
  return {
    select: spy(() => chain),
    insert: spy(() => chain),
    update: spy(() => chain),
    delete: spy(() => chain),
    _: api,
  };
}

function makeEnv(): Env {
  return createMockEnv();
}

Deno.test("buildStoredEndpointForRuntime - rejects cloudflare.worker runtime alias", () => {
  const endpoint = buildStoredEndpointForRuntime({
    endpointName: "api",
    routes: [],
    targetServiceRef: "cf-api",
    runtime: "cloudflare.worker",
  });

  assertEquals(endpoint, null);
});

Deno.test("InfraService.upsertWorker - creates a new infra worker when none exists", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const drizzle = createDrizzleMock();
  drizzle._.get = async () => undefined; // no existing
  withInfraDeps(drizzle);

  try {
    const service = new InfraService(makeEnv());
    const id = await service.upsertWorker({
      spaceId: "ws-1",
      bundleDeploymentId: "bd-1",
      name: "api-worker",
      runtime: "takos.worker",
      cloudflareServiceRef: "cf-api",
    });

    assertEquals(id, "infra-new");
    assert(drizzle.insert.calls.length > 0);
  } finally {
    restoreInfraDeps();
  }
});
Deno.test("InfraService.upsertWorker - updates existing infra worker", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const drizzle = createDrizzleMock();
  drizzle._.get = async () => ({ id: "existing-id" }); // existing found
  withInfraDeps(drizzle);

  try {
    const service = new InfraService(makeEnv());
    const id = await service.upsertWorker({
      spaceId: "ws-1",
      bundleDeploymentId: "bd-1",
      name: "api-worker",
      runtime: "takos.worker",
    });

    assertEquals(id, "existing-id");
    assert(drizzle.update.calls.length > 0);
  } finally {
    restoreInfraDeps();
  }
});

Deno.test("InfraService.upsertEndpoint - creates a new endpoint with routes", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const drizzle = createDrizzleMock();
  drizzle._.get = async () => undefined; // no existing
  withInfraDeps(drizzle);

  try {
    const service = new InfraService(makeEnv());
    const id = await service.upsertEndpoint({
      spaceId: "ws-1",
      bundleDeploymentId: "bd-1",
      name: "api",
      protocol: "http",
      targetServiceRef: "api-worker",
      routes: [{ pathPrefix: "/api" }],
    });

    assertEquals(id, "infra-new");
    assertSpyCalls(drizzle.insert, 2); // endpoint + route
  } finally {
    restoreInfraDeps();
  }
});
Deno.test("InfraService.upsertEndpoint - replaces routes when updating existing endpoint", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const drizzle = createDrizzleMock();
  drizzle._.get = async () => ({ id: "ep-1" }); // existing found
  withInfraDeps(drizzle);

  try {
    const service = new InfraService(makeEnv());
    const id = await service.upsertEndpoint({
      spaceId: "ws-1",
      bundleDeploymentId: "bd-1",
      name: "api",
      protocol: "http",
      targetServiceRef: "api-worker",
      routes: [{ pathPrefix: "/v2" }, {
        pathPrefix: "/health",
        methods: ["GET"],
      }],
    });

    assertEquals(id, "ep-1");
    assert(drizzle.delete.calls.length > 0); // delete old routes
    assert(drizzle.update.calls.length > 0);
  } finally {
    restoreInfraDeps();
  }
});

Deno.test("InfraService.buildRoutingTarget - returns null when no endpoints exist", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const drizzle = createDrizzleMock();
  drizzle._.all = async () => []; // no endpoints
  withInfraDeps(drizzle);

  try {
    const service = new InfraService(makeEnv());
    const target = await service.buildRoutingTarget("ws-1", "bd-1");
    assertEquals(target, null);
  } finally {
    restoreInfraDeps();
  }
});
Deno.test("InfraService.buildRoutingTarget - builds routing target from endpoints and workers", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const drizzle = createDrizzleMock();
  let allCallCount = 0;
  drizzle._.all = async () => {
    allCallCount++;
    if (allCallCount === 1) {
      return [
        {
          id: "ep-1",
          accountId: "ws-1",
          name: "api",
          protocol: "http",
          targetServiceRef: "api-worker",
          timeoutMs: 30000,
          bundleDeploymentId: "bd-1",
        },
      ];
    }
    if (allCallCount === 2) {
      return [
        {
          endpointId: "ep-1",
          position: 0,
          pathPrefix: "/api",
          methodsJson: null,
        },
      ];
    }
    return [
      {
        name: "api-worker",
        cloudflareServiceRef: "cf-api",
        runtime: "takos.worker",
      },
    ];
  };
  withInfraDeps(drizzle);

  try {
    const service = new InfraService(makeEnv());
    const target = await service.buildRoutingTarget("ws-1", "bd-1");

    assertNotEquals(target, null);
    assertEquals(target!.type, "http-endpoint-set");
    if (target?.type !== "http-endpoint-set") {
      throw new Error("expected http-endpoint-set target");
    }
    assertEquals(target.endpoints.length, 1);
    if (target.endpoints[0].target.kind !== "service-ref") {
      throw new Error("expected service-ref target");
    }
    assertEquals(target.endpoints[0].target.ref, "cf-api");
  } finally {
    restoreInfraDeps();
  }
});
Deno.test("InfraService.buildRoutingTarget - skips unknown non-url runtimes", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const drizzle = createDrizzleMock();
  let allCallCount = 0;
  drizzle._.all = async () => {
    allCallCount++;
    if (allCallCount === 1) {
      return [
        {
          id: "ep-1",
          accountId: "ws-1",
          name: "api",
          protocol: "http",
          targetServiceRef: "ext-worker",
          timeoutMs: null,
          bundleDeploymentId: "bd-1",
        },
      ];
    }
    if (allCallCount === 2) {
      return [];
    }
    return [
      { name: "ext-worker", cloudflareServiceRef: null, runtime: "docker" },
    ];
  };
  withInfraDeps(drizzle);

  try {
    const service = new InfraService(makeEnv());
    const target = await service.buildRoutingTarget("ws-1", "bd-1");
    assertEquals(target, null);
  } finally {
    restoreInfraDeps();
  }
});

Deno.test("InfraService.deleteByBundleDeployment - deletes endpoints, routes, and workers", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const drizzle = createDrizzleMock();
  drizzle._.all = async () => [{ id: "ep-1" }, { id: "ep-2" }]; // endpoints to delete
  withInfraDeps(drizzle);

  try {
    const service = new InfraService(makeEnv());
    await service.deleteByBundleDeployment("ws-1", "bd-1");

    // routes for ep-1, routes for ep-2, endpoints, workers
    assertSpyCalls(drizzle.delete, 4);
  } finally {
    restoreInfraDeps();
  }
});
