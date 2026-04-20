import { assertEquals, assertRejects } from "jsr:@std/assert";

import { reconcileGroupRouting } from "../group-routing.ts";
import type { GroupDesiredState, ObservedGroupState } from "../group-state.ts";
import {
  applyRoutingToHostnames,
  runRoutingMutationWithRollback,
  snapshotRouting,
} from "../routing.ts";
import type {
  RoutingRecord,
  RoutingStore,
  RoutingTarget,
} from "../../routing/routing-models.ts";
import type { Env } from "../../../../shared/types/env.ts";

function createRoutingStore(options: {
  failOnPutCall?: number;
  failOnDeleteCall?: number;
  failMessage?: string;
} = {}): RoutingStore & {
  records: Map<string, RoutingRecord>;
} {
  const records = new Map<string, RoutingRecord>();
  let putCalls = 0;
  let deleteCalls = 0;
  return {
    records,
    async getRecord(hostname) {
      return records.get(hostname) ?? null;
    },
    async putRecord(hostname, target, updatedAt) {
      putCalls += 1;
      if (options.failOnPutCall === putCalls) {
        throw new Error(options.failMessage ?? "forced put failure");
      }
      const record = {
        hostname,
        target,
        version: (records.get(hostname)?.version ?? 0) + 1,
        updatedAt,
      };
      records.set(hostname, record);
      return record;
    },
    async deleteRecord(hostname, tombstoneTtlMs, updatedAt) {
      deleteCalls += 1;
      if (options.failOnDeleteCall === deleteCalls) {
        throw new Error(options.failMessage ?? "forced delete failure");
      }
      const record = {
        hostname,
        target: null,
        version: (records.get(hostname)?.version ?? 0) + 1,
        updatedAt,
        tombstoneUntil: updatedAt + tombstoneTtlMs,
      };
      records.set(hostname, record);
      return record;
    },
  };
}

function endpointTarget(name: string, baseUrl: string): RoutingTarget {
  return {
    type: "http-endpoint-set",
    endpoints: [
      {
        name,
        routes: [],
        target: {
          kind: "http-url",
          baseUrl,
        },
      },
    ],
  };
}

function desiredState(): GroupDesiredState {
  return {
    apiVersion: "takos.dev/v1alpha1",
    kind: "GroupDesiredState",
    groupName: "docs",
    version: "1.0.0",
    backend: "local",
    env: "default",
    manifest: {
      name: "docs",
      version: "1.0.0",
      compute: {},
      routes: [],
      publish: [],
      env: {},
    },
    workloads: {},
    routes: {
      "web:/": {
        name: "web:/",
        target: "web",
        path: "/",
      },
      "api:/api": {
        name: "api:/api",
        target: "api",
        path: "/api",
      },
    },
  };
}

function workloads(): ObservedGroupState["workloads"] {
  return {
    web: {
      serviceId: "svc_web",
      name: "web",
      category: "worker",
      status: "deployed",
      hostname: "legacy-web.apps.example",
      routeRef: "web-route-ref",
      updatedAt: "2026-04-18T00:00:00.000Z",
    },
    api: {
      serviceId: "svc_api",
      name: "api",
      category: "service",
      status: "deployed",
      hostname: "legacy-api.apps.example",
      resolvedBaseUrl: "http://127.0.0.1:8080",
      updatedAt: "2026-04-18T00:00:00.000Z",
    },
  };
}

Deno.test("reconcileGroupRouting uses one group hostname set for all routes", async () => {
  const routingStore = createRoutingStore();
  const env = {
    ROUTING_STORE: routingStore,
  } as unknown as Env;
  const currentRoutes: ObservedGroupState["routes"] = {
    "web:/": {
      name: "web:/",
      target: "web",
      path: "/",
      url: "https://legacy-web.apps.example/",
    },
    "api:/api": {
      name: "api:/api",
      target: "api",
      path: "/api",
      url: "https://legacy-api.apps.example/api",
    },
  };

  const result = await reconcileGroupRouting(
    env,
    desiredState(),
    currentRoutes,
    workloads(),
    "2026-04-18T01:00:00.000Z",
    {
      groupHostnames: [
        "space-docs.apps.example",
        "docs.apps.example",
        "docs.example.com",
      ],
    },
  );

  assertEquals(result.failedRoutes, []);
  assertEquals(
    result.routes["web:/"].url,
    "https://space-docs.apps.example/",
  );
  assertEquals(
    result.routes["api:/api"].url,
    "https://space-docs.apps.example/api",
  );

  for (
    const hostname of [
      "space-docs.apps.example",
      "docs.apps.example",
      "docs.example.com",
    ]
  ) {
    const target = routingStore.records.get(hostname)?.target as
      | RoutingTarget
      | null
      | undefined;
    assertEquals(target?.type, "http-endpoint-set");
    assertEquals(
      target?.type === "http-endpoint-set"
        ? target.endpoints.map((endpoint) => endpoint.name)
        : [],
      ["web:/", "api:/api"],
    );
  }

  assertEquals(
    routingStore.records.get("legacy-web.apps.example")?.target,
    null,
  );
  assertEquals(
    routingStore.records.get("legacy-api.apps.example")?.target,
    null,
  );
});

Deno.test(
  "runRoutingMutationWithRollback restores routing after partial hostname apply failure",
  async () => {
    const routingStore = createRoutingStore({
      failOnPutCall: 2,
      failMessage: "forced put failure",
    });
    const env = {
      ROUTING_STORE: routingStore,
    } as unknown as Env;

    const alphaTarget = endpointTarget("alpha", "https://alpha.example");
    const betaTarget = endpointTarget("beta", "https://beta.example");
    routingStore.records.set("alpha.apps.example", {
      hostname: "alpha.apps.example",
      target: alphaTarget,
      version: 1,
      updatedAt: Date.parse("2026-04-18T00:00:00.000Z"),
    });
    routingStore.records.set("beta.apps.example", {
      hostname: "beta.apps.example",
      target: betaTarget,
      version: 1,
      updatedAt: Date.parse("2026-04-18T00:00:00.000Z"),
    });

    const rollbackSnapshot = await snapshotRouting(env, [
      "alpha.apps.example",
      "beta.apps.example",
    ]);

    await assertRejects(
      () =>
        runRoutingMutationWithRollback(
          env,
          rollbackSnapshot,
          () =>
            applyRoutingToHostnames(env, [
              "alpha.apps.example",
              "beta.apps.example",
            ], endpointTarget("next", "https://next.example")),
        ),
      Error,
      "forced put failure",
    );

    assertEquals(
      routingStore.records.get("alpha.apps.example")?.target,
      alphaTarget,
    );
    assertEquals(
      routingStore.records.get("beta.apps.example")?.target,
      betaTarget,
    );
  },
);

Deno.test(
  "reconcileGroupRouting restores hostname state when delete fails mid-reconciliation",
  async () => {
    const routingStore = createRoutingStore({
      failOnDeleteCall: 1,
      failMessage: "forced delete failure",
    });
    const env = {
      ROUTING_STORE: routingStore,
    } as unknown as Env;
    const currentRoutes: ObservedGroupState["routes"] = {
      "web:/": {
        name: "web:/",
        target: "web",
        path: "/",
        url: "https://legacy-web.apps.example/",
      },
      "api:/api": {
        name: "api:/api",
        target: "api",
        path: "/api",
        url: "https://legacy-web.apps.example/api",
      },
    };
    const oldTarget = endpointTarget("legacy", "https://legacy-target.example");
    routingStore.records.set("legacy-web.apps.example", {
      hostname: "legacy-web.apps.example",
      target: oldTarget,
      version: 1,
      updatedAt: Date.parse("2026-04-18T00:00:00.000Z"),
    });

    await assertRejects(
      () =>
        reconcileGroupRouting(
          env,
          desiredState(),
          currentRoutes,
          workloads(),
          "2026-04-18T01:00:00.000Z",
          {
            groupHostnames: ["space-docs.apps.example"],
          },
        ),
      Error,
      "forced delete failure",
    );

    assertEquals(
      routingStore.records.get("legacy-web.apps.example")?.target,
      oldTarget,
    );
    assertEquals(
      routingStore.records.get("space-docs.apps.example")?.target,
      null,
    );
  },
);
