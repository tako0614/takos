import { assertEquals } from "jsr:@std/assert";
import { assertSpyCalls, stub } from "jsr:@std/testing/mock";
import { createDispatchWorker, type DispatchEnv } from "../../dispatch.ts";
import {
  selectDeploymentTargetFromRoutingTarget,
  selectRouteRefFromRoutingTarget,
} from "../../application/services/routing/service.ts";
import type { ControlPlatform } from "../../platform/platform-config.ts";
import type {
  ResolvedRouting,
  RoutingTarget,
} from "../../application/services/routing/routing-models.ts";

function createDispatchEnv(): DispatchEnv {
  return {
    ADMIN_DOMAIN: "admin.local",
    DISPATCHER: {
      get() {
        throw new Error("DISPATCHER should not be used by this test");
      },
    },
    ROUTING_STORE: {
      async getRecord() {
        return null;
      },
      async putRecord() {
        throw new Error("not implemented");
      },
      async deleteRecord() {
        throw new Error("not implemented");
      },
    },
  };
}

function createPlatform(
  env: DispatchEnv,
  resolved: ResolvedRouting,
  serviceRegistry?: ControlPlatform<DispatchEnv>["services"]["serviceRegistry"],
): ControlPlatform<DispatchEnv> {
  return {
    source: "workers",
    bindings: env,
    config: {
      adminDomain: "admin.local",
      tenantBaseDomain: "local",
    },
    services: {
      routing: {
        async resolveHostname() {
          return resolved;
        },
        selectDeploymentTarget(target: RoutingTarget) {
          return selectDeploymentTargetFromRoutingTarget(target);
        },
        selectRouteRef(target: RoutingTarget) {
          return selectRouteRefFromRoutingTarget(target);
        },
      },
      queues: {},
      objects: {},
      notifications: {},
      locks: {},
      hosts: {},
      ai: {},
      assets: {},
      documents: {},
      serviceRegistry,
    },
  };
}

function createExecutionContext(): ExecutionContext {
  return {
    waitUntil() {},
    passThroughOnException() {},
    props: {},
  } as unknown as ExecutionContext;
}

Deno.test("dispatch routes service-ref deployments through the registry with deploymentId", async () => {
  const env = createDispatchEnv();
  let registryCall: { name: string; deploymentId?: string } | null = null;
  const target: RoutingTarget = {
    type: "deployments",
    deployments: [{
      routeRef: "worker-demo",
      deploymentId: "deployment-v2",
      weight: 100,
      status: "active",
    }],
  };
  const worker = createDispatchWorker((bindings) =>
    createPlatform(bindings, { target, tombstone: false, source: "store" }, {
      get(name, options) {
        registryCall = { name, deploymentId: options?.deploymentId };
        return {
          async fetch(request: Request) {
            return Response.json({
              worker: request.headers.get("X-Tenant-Worker"),
              deployment: request.headers.get("X-Tenant-Deployment"),
              internal: request.headers.get("X-Takos-Internal-Marker"),
              legacyInternal: request.headers.get("X-Takos-Internal"),
            });
          },
        };
      },
    })
  );

  const response = await worker.fetch(
    new Request("https://tenant.local/api"),
    env,
    createExecutionContext(),
  );

  assertEquals(response.status, 200);
  assertEquals(await response.json(), {
    worker: "worker-demo",
    deployment: "deployment-v2",
    internal: "1",
    legacyInternal: null,
  });
  assertEquals(registryCall, {
    name: "worker-demo",
    deploymentId: "deployment-v2",
  });
});

Deno.test("dispatch forwards http-url targets without tenant-internal headers", async () => {
  const env = createDispatchEnv();
  const target: RoutingTarget = {
    type: "http-endpoint-set",
    endpoints: [{
      name: "container",
      routes: [{ pathPrefix: "/api" }],
      target: {
        kind: "http-url",
        baseUrl: "https://container.example/base/",
      },
    }],
  };
  const fetchSpy = stub(
    globalThis,
    "fetch",
    (async (input: RequestInfo | URL) => {
      const request = input instanceof Request ? input : new Request(input);
      assertEquals(request.url, "https://container.example/base/api/run?x=1");
      assertEquals(request.headers.get("X-Forwarded-Host"), "tenant.local");
      assertEquals(request.headers.get("X-Tenant-Endpoint"), "container");
      assertEquals(request.headers.get("X-Tenant-Worker"), null);
      assertEquals(request.headers.get("X-Tenant-Deployment"), null);
      assertEquals(request.headers.get("X-Takos-Internal"), null);
      assertEquals(request.headers.get("X-Takos-Internal-Marker"), null);
      return new Response("ok");
    }) as typeof globalThis.fetch,
  );
  const worker = createDispatchWorker((bindings) =>
    createPlatform(bindings, { target, tombstone: false, source: "store" })
  );

  try {
    const response = await worker.fetch(
      new Request("https://tenant.local/api/run?x=1", {
        headers: {
          "X-Takos-Internal": "spoofed",
          "X-Takos-Internal-Marker": "spoofed",
          "X-Tenant-Worker": "spoofed",
          "X-Tenant-Deployment": "spoofed",
        },
      }),
      env,
      createExecutionContext(),
    );

    assertEquals(response.status, 200);
    assertEquals(await response.text(), "ok");
    assertSpyCalls(fetchSpy, 1);
  } finally {
    fetchSpy.restore();
  }
});
