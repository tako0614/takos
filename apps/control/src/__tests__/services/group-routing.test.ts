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
      apiVersion: "takos.dev/v1alpha1",
      kind: "App",
      metadata: { name: "demo-app" },
      spec: {
        version: "1.0.0",
        workers: {
          edge: {
            build: {
              fromWorkflow: {
                path: ".github/workflows/deploy.yml",
                job: "build",
                artifact: "edge",
                artifactPath: "dist/edge.js",
              },
            },
          },
        },
        services: {
          api: {
            dockerfile: "Dockerfile",
            port: 8080,
          },
        },
        routes: [
          {
            name: "api",
            ingress: "edge",
            target: "api",
            path: "/api",
          },
        ],
      },
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

  assertEquals(putCalls.length, 1);
  assertObjectMatch(putCalls[0], {
    hostname: "edge.example.test",
  });
  assertEquals(deleteCalls, [{ hostname: "old.example.test" }]);
  assertEquals(result.failedRoutes, []);
  assertObjectMatch(result.routes.api, {
    target: "api",
    url: "http://10.0.0.12:8080/api",
  });
  assertEquals(result.routes.stale, undefined);
});
