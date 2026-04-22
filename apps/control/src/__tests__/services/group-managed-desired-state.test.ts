import { assertEquals } from "jsr:@std/assert";

import { compileGroupDesiredState } from "@/services/deployment/group-state";
import {
  type GroupManagedDesiredStateDeps,
  syncGroupManagedDesiredState,
} from "@/services/deployment/group-managed-desired-state";

function createManagedStateDbMock() {
  const emptyRowsQuery = {
    all: async () => [],
    orderBy: () => emptyRowsQuery,
    then: (
      resolve: (value: unknown[]) => void,
      reject: (reason?: unknown) => void,
    ) => Promise.resolve([]).then(resolve, reject),
  };
  return {
    select: () => ({
      from: () => ({
        where: () => emptyRowsQuery,
      }),
    }),
    insert: () => ({
      values: () => ({
        run: async () => undefined,
      }),
    }),
    update: () => ({
      set: () => ({
        where: () => ({
          run: async () => undefined,
        }),
      }),
    }),
    delete: () => ({
      where: () => ({
        run: async () => undefined,
      }),
    }),
  };
}

Deno.test("group managed desired state sync - syncs publications, consumes, and resolved env into service desired state", async () => {
  const replaceManifestPublicationsCalls: unknown[] = [];
  const replaceServiceConsumesCalls: unknown[] = [];
  const resolveServiceConsumeEnvVarsCalls: unknown[] = [];
  const replaceLocalEnvVarsCalls: unknown[] = [];

  const deps = {
    createDesiredStateService: () => ({
      listLocalEnvVars: async () => [],
      listResourceBindings: async () => [],
      replaceLocalEnvVars: async (params: unknown) => {
        replaceLocalEnvVarsCalls.push(params);
      },
    }),
    listServiceConsumes: async () => [],
    replaceManifestPublications: async (_env, params) => {
      replaceManifestPublicationsCalls.push(params);
    },
    previewServiceConsumeEnvVars: async (_env, params) => {
      if (!params.consumes) return [];
      return [{ name: "TOOLS_URL", secret: false }];
    },
    replaceServiceConsumes: async (_env, params) => {
      replaceServiceConsumesCalls.push(params);
      return params.consumes ?? [];
    },
    resolveServiceConsumeEnvVars: async (_env, params) => {
      resolveServiceConsumeEnvVarsCalls.push(params);
      if (params.serviceId !== "svc-api") return [];
      return [
        {
          name: "TOOLS_URL",
          value: "https://edge.example.test/mcp",
          secret: false,
        },
      ];
    },
    resolveLinkedCommonEnvState: async () => ({
      envBindings: [],
      envVars: {},
      commonEnvUpdates: [],
    }),
    createServiceBinding: async () => {},
    deleteServiceBinding: async () => {},
  } satisfies GroupManagedDesiredStateDeps;

  const desired = compileGroupDesiredState(
    {
      name: "demo-app",
      version: "1.0.0",
      env: {
        API_URL: "https://api.example.test",
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
          image:
            "ghcr.io/example/api@sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
          port: 8080,
          env: {
            API_MODE: "service",
          },
          consume: [
            {
              publication: "tools",
              env: { url: "TOOLS_URL" },
            },
          ],
        },
      },
      routes: [
        { target: "edge", path: "/mcp" },
      ],
      publish: [
        {
          type: "McpServer",
          name: "tools",
          publisher: "edge",
          path: "/mcp",
          spec: { transport: "streamable-http" },
        },
      ],
    },
    {
      groupName: "demo-app",
      backend: "cloudflare",
      envName: "production",
    },
  );

  const failures = await syncGroupManagedDesiredState(
    {
      ENCRYPTION_KEY: "test-key",
      ADMIN_DOMAIN: "admin.example.test",
      DB: createManagedStateDbMock(),
    } as never,
    {
      spaceId: "ws-1",
      desiredState: desired,
      observedState: {
        groupId: "group-1",
        groupName: "demo-app",
        backend: "cloudflare",
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
      resourceRows: [],
    },
    deps,
  );

  assertEquals(failures, []);

  assertEquals(replaceManifestPublicationsCalls.length, 1);
  assertEquals(replaceManifestPublicationsCalls[0], {
    spaceId: "ws-1",
    groupId: "group-1",
    manifest: {
      publish: [
        {
          type: "McpServer",
          name: "tools",
          publisher: "edge",
          path: "/mcp",
          spec: { transport: "streamable-http" },
        },
      ],
      routes: [
        { target: "edge", path: "/mcp" },
      ],
    },
    observedState: {
      groupId: "group-1",
      groupName: "demo-app",
      backend: "cloudflare",
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
  });

  assertEquals(replaceServiceConsumesCalls, [
    {
      spaceId: "ws-1",
      serviceId: "svc-edge",
      serviceName: "demo-app:edge",
      consumes: undefined,
    },
    {
      spaceId: "ws-1",
      serviceId: "svc-api",
      serviceName: "demo-app:api",
      consumes: [
        {
          publication: "tools",
          env: { url: "TOOLS_URL" },
        },
      ],
    },
  ]);
  assertEquals(resolveServiceConsumeEnvVarsCalls, [
    { spaceId: "ws-1", serviceId: "svc-edge" },
    { spaceId: "ws-1", serviceId: "svc-api" },
  ]);

  assertEquals(replaceLocalEnvVarsCalls, [
    {
      spaceId: "ws-1",
      serviceId: "svc-edge",
      variables: [
        { name: "TAKOS_SPACE_ID", value: "ws-1", secret: false },
        { name: "API_URL", value: "https://api.example.test", secret: false },
        { name: "WORKER_MODE", value: "edge", secret: false },
      ],
    },
    {
      spaceId: "ws-1",
      serviceId: "svc-api",
      variables: [
        { name: "TAKOS_SPACE_ID", value: "ws-1", secret: false },
        { name: "API_URL", value: "https://api.example.test", secret: false },
        { name: "API_MODE", value: "service", secret: false },
        {
          name: "TOOLS_URL",
          value: "https://edge.example.test/mcp",
          secret: false,
        },
      ],
    },
  ]);
});

Deno.test("group managed desired state sync - preflights consume env collisions before persisting consumes", async () => {
  const replaceServiceConsumesCalls: unknown[] = [];

  const deps = {
    createDesiredStateService: () => ({
      listLocalEnvVars: async () => [],
      listResourceBindings: async () => [],
      replaceLocalEnvVars: async () => {},
    }),
    listServiceConsumes: async () => [],
    replaceManifestPublications: async () => {},
    previewServiceConsumeEnvVars: async () => [
      { name: "PUBLICATION_SEARCH_URL", secret: false },
    ],
    replaceServiceConsumes: async (_env, params) => {
      replaceServiceConsumesCalls.push(params);
      return params.consumes ?? [];
    },
    resolveServiceConsumeEnvVars: async () => [],
    resolveLinkedCommonEnvState: async () => ({
      envBindings: [],
      envVars: {},
      commonEnvUpdates: [],
    }),
    createServiceBinding: async () => {},
    deleteServiceBinding: async () => {},
  } satisfies GroupManagedDesiredStateDeps;

  const desired = compileGroupDesiredState(
    {
      name: "demo-app",
      version: "1.0.0",
      env: {},
      compute: {
        web: {
          kind: "worker",
          build: {
            fromWorkflow: {
              path: ".takos/workflows/deploy.yml",
              job: "build",
              artifact: "web",
              artifactPath: "dist/web.js",
            },
          },
          env: {
            PUBLICATION_SEARCH_URL: "manual",
          },
          consume: [{ publication: "search" }],
        },
      },
      routes: [],
      publish: [],
    },
    {
      groupName: "demo-app",
      backend: "cloudflare",
      envName: "production",
    },
  );

  const failures = await syncGroupManagedDesiredState(
    {
      ENCRYPTION_KEY: "test-key",
      ADMIN_DOMAIN: "admin.example.test",
      DB: createManagedStateDbMock(),
    } as never,
    {
      spaceId: "ws-1",
      desiredState: desired,
      observedState: {
        groupId: "group-1",
        groupName: "demo-app",
        backend: "cloudflare",
        env: "production",
        version: "1.0.0",
        updatedAt: "2026-03-29T00:00:00.000Z",
        resources: {},
        workloads: {
          web: {
            serviceId: "svc-web",
            name: "web",
            category: "worker",
            status: "deployed",
            hostname: "web.example.test",
            routeRef: "worker-web",
            updatedAt: "2026-03-29T00:00:00.000Z",
          },
        },
        routes: {},
      },
      resourceRows: [],
    },
    deps,
  );

  assertEquals(replaceServiceConsumesCalls, [
    {
      spaceId: "ws-1",
      serviceId: "svc-web",
      serviceName: "demo-app:web",
      consumes: [],
    },
  ]);
  assertEquals(failures.length, 1);
  assertEquals(failures[0].name, "web");
  assertEquals(
    failures[0].error,
    "consume output resolves env 'PUBLICATION_SEARCH_URL' which already exists in compute 'web'",
  );
});
