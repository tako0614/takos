import { assertEquals, assertObjectMatch } from "jsr:@std/assert";

import { compileGroupDesiredState } from "@/services/deployment/group-state";
import { reconcileGroupRouting } from "@/services/deployment/group-routing";

Deno.test("group routing reconciler - publishes hostname routing from canonical workloads and removes stale hostnames", async () => {
  const putCalls: Array<
    { hostname: string; payload: unknown; opts?: unknown }
  > = [];
  const deleteCalls: Array<{ hostname: string }> = [];

  const desired = compileGroupDesiredState(
    {
      name: "demo-app",
      version: "1.0.0",
      compute: {
        edge: {
          kind: "worker",
          build: {
            fromWorkflow: {
              path: ".takos/workflows/deploy.yml",
              job: "build",
              artifact: "edge",
              artifactPath: "dist/edge.js",
            },
          },
        },
        api: {
          kind: "service",
          image: "ghcr.io/example/api:latest",
          port: 8080,
        },
      },
      routes: [
        {
          target: "api",
          path: "/api",
        },
      ],
      publish: [],
      env: {},
    },
    {
      groupName: "demo-app",
      provider: "cloudflare",
      envName: "production",
    },
  );

  const result = await reconcileGroupRouting(
    {
      HOSTNAME_ROUTING: {
        async get() {
          return null;
        },
        async put(hostname: string, payload: unknown, opts?: unknown) {
          putCalls.push({ hostname, payload, opts });
        },
        async delete(hostname: string) {
          deleteCalls.push({ hostname });
        },
      },
    } as never,
    desired,
    {
      stale: {
        name: "stale",
        target: "edge",
        url: "https://old.example.test/old",
      },
    },
    {
      edge: {
        serviceId: "svc-edge",
        name: "edge",
        category: "worker",
        status: "deployed",
        hostname: "edge.example.test",
        routeRef: "worker-edge",
        updatedAt: "2026-03-29T00:00:00.000Z",
      },
      api: {
        serviceId: "svc-api",
        name: "api",
        category: "service",
        status: "deployed",
        hostname: "api.example.test",
        routeRef: "svc-api",
        resolvedBaseUrl: "http://10.0.0.12:8080",
        updatedAt: "2026-03-29T00:00:00.000Z",
      },
    },
    "2026-03-29T12:00:00.000Z",
  );

  // Flat schema removed `ingress` from routes — the route owner is always
  // `route.target`, so the hostname put is the api workload's own hostname.
  assertEquals(putCalls.length, 1);
  assertObjectMatch(putCalls[0], {
    hostname: "api.example.test",
  });
  assertEquals(deleteCalls, [{ hostname: "old.example.test" }]);
  assertEquals(result.failedRoutes, []);
  assertObjectMatch(result.routes["api:/api"], {
    target: "api",
    url: "http://10.0.0.12:8080/api",
  });
  assertEquals(result.routes.stale, undefined);
});
