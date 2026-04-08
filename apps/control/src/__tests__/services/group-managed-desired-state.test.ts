import { assertEquals } from "jsr:@std/assert";

import { compileGroupDesiredState } from "@/services/deployment/group-state";
import { syncGroupManagedDesiredState } from "@/services/deployment/group-managed-desired-state";
import { ServiceDesiredStateService } from "@/services/platform/worker-desired-state";

Deno.test("group managed desired state sync - syncs env, bindings, and MCP runtime config into the canonical desired-state tables", async () => {
  const replaceLocalEnvVarsCalls: unknown[] = [];
  const replaceResourceBindingsCalls: unknown[] = [];
  const saveRuntimeConfigCalls: unknown[] = [];

  const originalMethods = {
    replaceLocalEnvVars:
      ServiceDesiredStateService.prototype.replaceLocalEnvVars,
    replaceResourceBindings:
      ServiceDesiredStateService.prototype.replaceResourceBindings,
    saveRuntimeConfig: ServiceDesiredStateService.prototype.saveRuntimeConfig,
  };

  ServiceDesiredStateService.prototype.replaceLocalEnvVars =
    (async function (params) {
      replaceLocalEnvVarsCalls.push(params);
    }) as typeof ServiceDesiredStateService.prototype.replaceLocalEnvVars;
  ServiceDesiredStateService.prototype.replaceResourceBindings =
    (async function (params) {
      replaceResourceBindingsCalls.push(params);
    }) as typeof ServiceDesiredStateService.prototype.replaceResourceBindings;
  ServiceDesiredStateService.prototype.saveRuntimeConfig =
    (async function (params) {
      saveRuntimeConfigCalls.push(params);
      return {
        compatibility_flags: [],
        limits: {},
        updated_at: null,
      };
    }) as typeof ServiceDesiredStateService.prototype.saveRuntimeConfig;

  try {
    const desired = compileGroupDesiredState(
      {
        name: "demo-app",
        version: "1.0.0",
        env: {
          API_URL: "https://api.example.test",
        },
        storage: {
          db: { type: "sql", bind: "DB" },
          auth: { type: "secret", bind: "AUTH_TOKEN", generate: true },
          jobs: { type: "queue", bind: "JOBS" },
          idx: {
            type: "vector-index",
            bind: "INDEX",
            vectorIndex: { dimensions: 1536, metric: "cosine" },
          },
          events: {
            type: "analytics-engine",
            bind: "EVENTS",
          },
          flow: {
            type: "workflow",
            bind: "FLOW",
            workflow: { class: "MainWorkflow", script: "edge" },
          },
          counter: {
            type: "durable-object",
            bind: "COUNTER",
            durableObject: {
              class: "Counter",
              script: "edge",
            },
          },
        },
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
            env: {
              WORKER_MODE: "edge",
            },
          },
          api: {
            kind: "service",
            image: "ghcr.io/example/api:latest",
            port: 8080,
            env: {
              API_MODE: "service",
            },
          },
        },
        routes: [
          { target: "edge", path: "/api" },
          { target: "edge", path: "/mcp" },
        ],
        publish: [
          {
            type: "McpServer",
            name: "tools",
            path: "/mcp",
            transport: "streamable-http",
          },
        ],
        scopes: [],
      },
      {
        groupName: "demo-app",
        provider: "cloudflare",
        envName: "production",
      },
    );

    await syncGroupManagedDesiredState(
      { ENCRYPTION_KEY: "test-key", DB: {} as never } as never,
      {
        spaceId: "ws-1",
        desiredState: desired,
        observedState: {
          groupId: "group-1",
          groupName: "demo-app",
          provider: "cloudflare",
          env: "production",
          version: "1.0.0",
          updatedAt: "2026-03-29T00:00:00.000Z",
          resources: {},
          workloads: {
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
              resolvedBaseUrl: "http://10.0.0.2:8080",
              updatedAt: "2026-03-29T00:00:00.000Z",
            },
          },
          routes: {},
        },
        resourceRows: [
          {
            id: "res-db",
            groupId: "group-1",
            name: "db",
            category: "resource",
            providerResourceId: "d1-id",
            providerResourceName: "demo-db",
            config: {
              type: "sql",
              manifestType: "sql",
              resourceClass: "sql",
              backing: "d1",
              binding: "DB",
              bindingName: "DB",
              bindingType: "sql",
              cfResourceId: "d1-id",
              providerResourceName: "demo-db",
            },
            createdAt: "2026-03-29T00:00:00.000Z",
            updatedAt: "2026-03-29T00:00:00.000Z",
          },
          {
            id: "res-auth",
            groupId: "group-1",
            name: "auth",
            category: "resource",
            providerResourceId: "secret-value",
            providerResourceName: "demo-auth",
            config: {
              type: "secret",
              manifestType: "secret",
              resourceClass: "secret",
              backing: "secret_ref",
              binding: "AUTH_TOKEN",
              bindingName: "AUTH_TOKEN",
              bindingType: "secret_text",
              cfResourceId: "secret-value",
              providerResourceName: "demo-auth",
            },
            createdAt: "2026-03-29T00:00:00.000Z",
            updatedAt: "2026-03-29T00:00:00.000Z",
          },
          {
            id: "res-jobs",
            groupId: "group-1",
            name: "jobs",
            category: "resource",
            providerResourceId: "queue-id",
            providerResourceName: "tenant-jobs",
            config: {
              type: "queue",
              manifestType: "queue",
              resourceClass: "queue",
              backing: "queue",
              binding: "JOBS",
              bindingName: "JOBS",
              bindingType: "queue",
              cfResourceId: "queue-id",
              providerResourceName: "tenant-jobs",
            },
            createdAt: "2026-03-29T00:00:00.000Z",
            updatedAt: "2026-03-29T00:00:00.000Z",
          },
          {
            id: "res-idx",
            groupId: "group-1",
            name: "idx",
            category: "resource",
            providerResourceId: "idx-id",
            providerResourceName: "tenant-idx",
            config: {
              type: "vector-index",
              manifestType: "vector-index",
              resourceClass: "vector_index",
              backing: "vectorize",
              binding: "INDEX",
              bindingName: "INDEX",
              bindingType: "vector_index",
              cfResourceId: "idx-id",
              providerResourceName: "tenant-idx",
            },
            createdAt: "2026-03-29T00:00:00.000Z",
            updatedAt: "2026-03-29T00:00:00.000Z",
          },
          {
            id: "res-events",
            groupId: "group-1",
            name: "events",
            category: "resource",
            providerResourceId: "events-id",
            providerResourceName: "tenant-events",
            config: {
              type: "analytics-engine",
              manifestType: "analytics-engine",
              resourceClass: "analytics_store",
              backing: "analytics_engine",
              binding: "EVENTS",
              bindingName: "EVENTS",
              bindingType: "analytics_store",
              cfResourceId: "events-id",
              providerResourceName: "tenant-events",
            },
            createdAt: "2026-03-29T00:00:00.000Z",
            updatedAt: "2026-03-29T00:00:00.000Z",
          },
          {
            id: "res-flow",
            groupId: "group-1",
            name: "flow",
            category: "resource",
            providerResourceId: "flow-id",
            providerResourceName: "flow",
            config: {
              type: "workflow",
              manifestType: "workflow",
              resourceClass: "workflow_runtime",
              backing: "workflow_binding",
              binding: "FLOW",
              bindingName: "FLOW",
              bindingType: "workflow_runtime",
              cfResourceId: "flow-id",
              providerResourceName: "flow",
            },
            createdAt: "2026-03-29T00:00:00.000Z",
            updatedAt: "2026-03-29T00:00:00.000Z",
          },
          {
            id: "res-counter",
            groupId: "group-1",
            name: "counter",
            category: "resource",
            providerResourceId: "counter-id",
            providerResourceName: "counter",
            config: {
              type: "durable-object",
              manifestType: "durable-object",
              resourceClass: "durable_namespace",
              backing: "durable_object_namespace",
              binding: "COUNTER",
              bindingName: "COUNTER",
              bindingType: "durable_namespace",
              cfResourceId: "counter-id",
              providerResourceName: "counter",
            },
            createdAt: "2026-03-29T00:00:00.000Z",
            updatedAt: "2026-03-29T00:00:00.000Z",
          },
        ],
      },
    );
  } finally {
    ServiceDesiredStateService.prototype.replaceLocalEnvVars =
      originalMethods.replaceLocalEnvVars;
    ServiceDesiredStateService.prototype.replaceResourceBindings =
      originalMethods.replaceResourceBindings;
    ServiceDesiredStateService.prototype.saveRuntimeConfig =
      originalMethods.saveRuntimeConfig;
  }

  assertEquals(replaceLocalEnvVarsCalls[0], {
    spaceId: "ws-1",
    serviceId: "svc-edge",
    variables: [
      { name: "API_URL", value: "https://api.example.test", secret: false },
      { name: "AUTH_TOKEN", value: "secret-value", secret: true },
      { name: "WORKER_MODE", value: "edge", secret: false },
    ],
  });
  assertEquals(replaceLocalEnvVarsCalls[1], {
    spaceId: "ws-1",
    serviceId: "svc-api",
    variables: [
      { name: "API_URL", value: "https://api.example.test", secret: false },
      { name: "AUTH_TOKEN", value: "secret-value", secret: true },
      { name: "API_MODE", value: "service", secret: false },
    ],
  });

  assertEquals(replaceResourceBindingsCalls[0], {
    serviceId: "svc-edge",
    bindings: [
      { name: "DB", type: "sql", resourceId: "res-db" },
      { name: "AUTH_TOKEN", type: "secret", resourceId: "res-auth" },
      { name: "JOBS", type: "queue", resourceId: "res-jobs" },
      { name: "INDEX", type: "vector-index", resourceId: "res-idx" },
      { name: "EVENTS", type: "analytics-engine", resourceId: "res-events" },
      {
        name: "FLOW",
        type: "workflow",
        resourceId: "res-flow",
        config: {
          workflow_name: "flow",
          class_name: "MainWorkflow",
          script_name: "edge",
        },
      },
      {
        name: "COUNTER",
        type: "durable-object",
        resourceId: "res-counter",
        config: {
          class_name: "Counter",
          script_name: "edge",
        },
      },
    ],
  });
  assertEquals(replaceResourceBindingsCalls[1], {
    serviceId: "svc-api",
    bindings: [
      { name: "DB", type: "sql", resourceId: "res-db" },
      { name: "AUTH_TOKEN", type: "secret", resourceId: "res-auth" },
      { name: "JOBS", type: "queue", resourceId: "res-jobs" },
      { name: "INDEX", type: "vector-index", resourceId: "res-idx" },
      { name: "EVENTS", type: "analytics-engine", resourceId: "res-events" },
      {
        name: "FLOW",
        type: "workflow",
        resourceId: "res-flow",
        config: {
          workflow_name: "flow",
          class_name: "MainWorkflow",
          script_name: "edge",
        },
      },
      {
        name: "COUNTER",
        type: "durable-object",
        resourceId: "res-counter",
        config: {
          class_name: "Counter",
          script_name: "edge",
        },
      },
    ],
  });

  assertEquals(saveRuntimeConfigCalls[0], {
    serviceId: "svc-edge",
    spaceId: "ws-1",
    mcpServer: { enabled: true, name: "tools", path: "/mcp" },
  });
  assertEquals(saveRuntimeConfigCalls[1], {
    serviceId: "svc-api",
    spaceId: "ws-1",
    mcpServer: undefined,
  });
});
