import { assert, assertEquals } from "jsr:@std/assert";

import { compileGroupDesiredState } from "../group-state.ts";
import {
  captureManagedWorkloadDesiredState,
  restoreManagedWorkloadDesiredState,
  syncGroupManagedDesiredState,
  syncGroupPublicationDesiredState,
} from "../group-managed-desired-state.ts";

function createManagedStateDbMock(rows: unknown[] = []) {
  const resultQuery = {
    all: async () => rows,
    orderBy: () => resultQuery,
    then: (
      resolve: (value: unknown[]) => void,
      reject: (reason?: unknown) => void,
    ) => Promise.resolve(rows).then(resolve, reject),
  };
  return {
    select: () => ({
      from: () => ({
        where: () => resultQuery,
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

Deno.test(
  "syncGroupPublicationDesiredState restores manifest publications when publication sync fails",
  async () => {
    const publicationRows = [
      {
        id: "pub-1",
        accountId: "space-1",
        name: "tools",
        sourceType: "manifest",
        groupId: "group-1",
        ownerServiceId: "svc-web",
        catalogName: null,
        publicationType: "McpServer",
        specJson: JSON.stringify({
          name: "tools",
          publisher: "web",
          type: "McpServer",
          path: "/mcp",
          spec: { transport: "streamable-http" },
        }),
        resolvedJson: JSON.stringify({ url: "https://old.example.test/mcp" }),
        createdAt: "2026-04-20T00:00:00.000Z",
        updatedAt: "2026-04-20T00:00:00.000Z",
      },
    ];
    const replaceManifestPublicationsCalls: Array<{
      publish: Array<{
        name: string;
        publisher: string;
        type: string;
        outputs?: Record<string, { route?: string }>;
        spec?: Record<string, unknown>;
      }>;
      routes: Array<{ target: string; path: string }>;
    }> = [];

    const desiredState = compileGroupDesiredState({
      name: "demo",
      compute: {
        web: { kind: "worker" },
      },
      routes: [{ target: "web", path: "/mcp-v2" }],
      publish: [
        {
          name: "tools",
          publisher: "web",
          type: "McpServer",
          outputs: { url: { route: "/mcp-v2" } },
          spec: { transport: "streamable-http" },
        },
      ],
      env: {},
    });

    const failures = await syncGroupPublicationDesiredState(
      {
        DB: createManagedStateDbMock(publicationRows),
        ENCRYPTION_KEY: "test-key",
        ADMIN_DOMAIN: "admin.example.test",
      } as never,
      {
        spaceId: "space-1",
        desiredState,
        observedState: {
          groupId: "group-1",
          groupName: "demo",
          backend: "cloudflare",
          env: "default",
          version: "1.0.0",
          updatedAt: "2026-04-20T00:00:00.000Z",
          resources: {},
          workloads: {
            web: {
              serviceId: "svc-web",
              name: "web",
              category: "worker",
              status: "active",
              hostname: "web.example.test",
              routeRef: "route-web",
              updatedAt: "2026-04-20T00:00:00.000Z",
            },
          },
          routes: {
            web: {
              name: "web",
              target: "web",
              path: "/mcp",
              updatedAt: "2026-04-20T00:00:00.000Z",
            },
          },
        },
      },
      {
        replaceManifestPublications: async (_env, params) => {
          replaceManifestPublicationsCalls.push({
            publish: params.manifest.publish ?? [],
            routes: params.manifest.routes ?? [],
          });
          if (replaceManifestPublicationsCalls.length === 1) {
            throw new Error("publication sync failed");
          }
        },
      },
    );

    assertEquals(failures, [
      { name: "publications", error: "publication sync failed" },
    ]);
    assertEquals(replaceManifestPublicationsCalls.length, 2);
    assertEquals(replaceManifestPublicationsCalls[0].publish, [
      {
        name: "tools",
        publisher: "web",
        type: "McpServer",
        outputs: { url: { route: "/mcp-v2" } },
        spec: { transport: "streamable-http" },
      },
    ]);
    assertEquals(replaceManifestPublicationsCalls[0].routes, [{
      target: "web",
      path: "/mcp-v2",
    }]);
    assertEquals(replaceManifestPublicationsCalls[1].publish, [
      {
        name: "tools",
        publisher: "web",
        type: "McpServer",
        outputs: { url: { route: "/mcp" } },
        spec: { transport: "streamable-http" },
      },
    ]);
    assertEquals(replaceManifestPublicationsCalls[1].routes, [{
      target: "web",
      path: "/mcp",
    }]);
  },
);

Deno.test(
  "syncGroupManagedDesiredState keeps linked common env out of local env vars",
  async () => {
    const desiredState = compileGroupDesiredState({
      name: "demo",
      compute: {
        web: {
          kind: "worker",
        },
      },
      routes: [],
      publish: [],
      env: {
        ROOT_ONLY: "root",
      },
    });

    let capturedVariables: Array<
      { name: string; value: string; secret?: boolean }
    > = [];
    const emptyRowsQuery = {
      all: async () => [],
      orderBy: () => emptyRowsQuery,
      then: (
        resolve: (value: unknown[]) => void,
        reject: (reason?: unknown) => void,
      ) => Promise.resolve([]).then(resolve, reject),
    };
    const result = await syncGroupManagedDesiredState(
      {
        DB: {
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
        } as never,
        ENCRYPTION_KEY: "test-key",
      } as never,
      {
        spaceId: "space-1",
        desiredState,
        observedState: {
          groupId: "group-1",
          groupName: "demo",
          backend: "cloudflare",
          env: "default",
          updatedAt: "2026-04-20T00:00:00.000Z",
          resources: {},
          workloads: {
            web: {
              serviceId: "service-1",
              name: "web",
              category: "worker",
              status: "active",
              updatedAt: "2026-04-20T00:00:00.000Z",
            },
          },
          routes: {},
        },
        resourceRows: [],
      },
      {
        createDesiredStateService: () => ({
          listLocalEnvVars: async () => [],
          listResourceBindings: async () => [],
          replaceLocalEnvVars: async (params) => {
            capturedVariables = params.variables;
          },
        }),
        listServiceConsumes: async () => [],
        previewServiceConsumeEnvVars: async () => [],
        replaceManifestPublications: async () => undefined,
        replaceServiceConsumes: async () => [],
        resolveServiceConsumeEnvVars: async () => [],
        resolveLinkedCommonEnvState: async () => ({
          envBindings: [
            { type: "plain_text", name: "SHARED", text: "linked-value" },
          ],
          envVars: { SHARED: "linked-value" },
          commonEnvUpdates: [],
        }),
      },
    );

    assertEquals(result, []);
    assertEquals(
      capturedVariables.some((entry) =>
        entry.name === "TAKOS_SPACE_ID" && entry.value === "space-1"
      ),
      true,
    );
    assertEquals(
      capturedVariables.some((entry) =>
        entry.name === "SHARED" &&
        entry.value === "linked-value"
      ),
      false,
    );
  },
);

Deno.test(
  "syncGroupManagedDesiredState keeps consumed publication env out of local env vars",
  async () => {
    const desiredState = compileGroupDesiredState({
      name: "demo",
      compute: {
        web: {
          kind: "worker",
          consume: [
            {
              publication: "takos-api",
              env: {
                endpoint: "TAKOS_STORAGE_API_URL",
                apiKey: "TAKOS_STORAGE_ACCESS_TOKEN",
              },
            },
          ],
        },
      },
      routes: [],
      publish: [
        {
          name: "takos-api",
          publisher: "takos",
          type: "api-key",
          spec: { scopes: ["files:read"] },
        },
      ],
      env: {},
    });

    let capturedVariables: Array<
      { name: string; value: string; secret?: boolean }
    > = [];
    const result = await syncGroupManagedDesiredState(
      {
        DB: createManagedStateDbMock() as never,
        ENCRYPTION_KEY: "test-key",
      } as never,
      {
        spaceId: "space-1",
        desiredState,
        observedState: {
          groupId: "group-1",
          groupName: "demo",
          backend: "cloudflare",
          env: "default",
          updatedAt: "2026-04-20T00:00:00.000Z",
          resources: {},
          workloads: {
            web: {
              serviceId: "service-1",
              name: "web",
              category: "worker",
              status: "active",
              updatedAt: "2026-04-20T00:00:00.000Z",
            },
          },
          routes: {},
        },
        resourceRows: [],
      },
      {
        createDesiredStateService: () => ({
          listLocalEnvVars: async () => [],
          listResourceBindings: async () => [],
          replaceLocalEnvVars: async (params) => {
            capturedVariables = params.variables;
          },
        }),
        listServiceConsumes: async () => [],
        previewServiceConsumeEnvVars: async () => [
          { name: "TAKOS_STORAGE_API_URL", secret: false },
          { name: "TAKOS_STORAGE_ACCESS_TOKEN", secret: true },
        ],
        replaceManifestPublications: async () => undefined,
        replaceServiceConsumes: async () => [],
        resolveServiceConsumeEnvVars: async () => [
          {
            name: "TAKOS_STORAGE_API_URL",
            value: "https://test.takos.jp",
            secret: false,
          },
          {
            name: "TAKOS_STORAGE_ACCESS_TOKEN",
            value: "token",
            secret: true,
          },
        ],
        resolveLinkedCommonEnvState: async () => ({
          envBindings: [],
          envVars: {},
          commonEnvUpdates: [],
        }),
      },
    );

    assertEquals(result, []);
    assertEquals(
      capturedVariables.some((entry) => entry.name === "TAKOS_STORAGE_API_URL"),
      false,
    );
    assertEquals(
      capturedVariables.some((entry) =>
        entry.name === "TAKOS_STORAGE_ACCESS_TOKEN"
      ),
      false,
    );
    assertEquals(
      capturedVariables.some((entry) =>
        entry.name === "TAKOS_SPACE_ID" && entry.value === "space-1"
      ),
      true,
    );
  },
);

Deno.test(
  "syncGroupManagedDesiredState provisions MCP authSecretRef as service secret env",
  async () => {
    const desiredState = compileGroupDesiredState({
      name: "docs",
      compute: {
        web: {
          kind: "worker",
        },
      },
      routes: [{ target: "web", path: "/mcp" }],
      publish: [
        {
          name: "docs-mcp",
          publisher: "web",
          type: "McpServer",
          outputs: { url: { route: "/mcp" } },
          spec: {
            transport: "streamable-http",
            authSecretRef: "MCP_AUTH_TOKEN",
          },
        },
      ],
      env: {},
    });

    let capturedVariables: Array<
      { name: string; value: string; secret?: boolean }
    > = [];
    const emptyRowsQuery = {
      all: async () => [],
      orderBy: () => emptyRowsQuery,
      then: (
        resolve: (value: unknown[]) => void,
        reject: (reason?: unknown) => void,
      ) => Promise.resolve([]).then(resolve, reject),
    };
    const result = await syncGroupManagedDesiredState(
      {
        DB: {
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
        } as never,
        ENCRYPTION_KEY: "test-key",
      } as never,
      {
        spaceId: "space-1",
        desiredState,
        observedState: {
          groupId: "group-1",
          groupName: "docs",
          backend: "cloudflare",
          env: "default",
          updatedAt: "2026-04-20T00:00:00.000Z",
          resources: {},
          workloads: {
            web: {
              serviceId: "service-1",
              name: "web",
              category: "worker",
              status: "active",
              updatedAt: "2026-04-20T00:00:00.000Z",
            },
          },
          routes: {},
        },
        resourceRows: [],
      },
      {
        createDesiredStateService: () => ({
          listLocalEnvVars: async () => [],
          listResourceBindings: async () => [],
          replaceLocalEnvVars: async (params) => {
            capturedVariables = params.variables;
          },
        }),
        listServiceConsumes: async () => [],
        previewServiceConsumeEnvVars: async () => [],
        replaceManifestPublications: async () => undefined,
        replaceServiceConsumes: async () => [],
        resolveServiceConsumeEnvVars: async () => [],
        resolveLinkedCommonEnvState: async () => ({
          envBindings: [],
          envVars: {},
          commonEnvUpdates: [],
        }),
      },
    );

    assertEquals(result, []);
    const token = capturedVariables.find((entry) =>
      entry.name === "MCP_AUTH_TOKEN"
    );
    assert(token);
    assertEquals(token.secret, true);
    assert(token.value.length >= 32);
  },
);

Deno.test(
  "syncGroupManagedDesiredState binds manifest resources to target workloads",
  async () => {
    const desiredState = compileGroupDesiredState({
      name: "computer",
      compute: {
        web: {
          kind: "worker",
        },
      },
      resources: {
        "session-index": {
          type: "key-value",
          bindings: [{ target: "web", binding: "SESSION_INDEX" }],
        },
      },
      routes: [],
      publish: [],
      env: {},
    });

    const createdBindings: Array<{
      serviceId: string;
      resourceId: string;
      bindingName: string;
      bindingType: string;
    }> = [];

    const result = await syncGroupManagedDesiredState(
      {
        DB: {} as never,
        ENCRYPTION_KEY: "test-key",
      } as never,
      {
        spaceId: "space-1",
        desiredState,
        observedState: {
          groupId: "group-1",
          groupName: "computer",
          backend: "cloudflare",
          env: "default",
          updatedAt: "2026-04-20T00:00:00.000Z",
          resources: {
            "session-index": {
              name: "session-index",
              type: "key-value",
              resourceId: "resource-1",
              binding: "SESSION_INDEX",
              status: "active",
              updatedAt: "2026-04-20T00:00:00.000Z",
            },
          },
          workloads: {
            web: {
              serviceId: "service-1",
              name: "web",
              category: "worker",
              status: "active",
              updatedAt: "2026-04-20T00:00:00.000Z",
            },
          },
          routes: {},
        },
        resourceRows: [{
          id: "resource-1",
          name: "session-index",
          config: {
            type: "key-value",
            binding: "SESSION_INDEX",
            bindingType: "kv",
          },
        }],
        syncPublications: false,
      },
      {
        createDesiredStateService: () => ({
          listLocalEnvVars: async () => [],
          listResourceBindings: async () => [],
          replaceLocalEnvVars: async () => undefined,
        }),
        listServiceConsumes: async () => [],
        previewServiceConsumeEnvVars: async () => [],
        replaceManifestPublications: async () => undefined,
        replaceServiceConsumes: async () => [],
        resolveServiceConsumeEnvVars: async () => [],
        resolveLinkedCommonEnvState: async () => ({
          envBindings: [],
          envVars: {},
          commonEnvUpdates: [],
        }),
        createServiceBinding: async (_db, input) => {
          createdBindings.push({
            serviceId: input.service_id,
            resourceId: input.resource_id,
            bindingName: input.binding_name,
            bindingType: input.binding_type,
          });
        },
        deleteServiceBinding: async () => undefined,
      },
    );

    assertEquals(result, []);
    assertEquals(createdBindings, [{
      serviceId: "service-1",
      resourceId: "resource-1",
      bindingName: "SESSION_INDEX",
      bindingType: "kv",
    }]);
  },
);

Deno.test(
  "captureManagedWorkloadDesiredState and restoreManagedWorkloadDesiredState round-trip local env vars",
  async () => {
    const serviceEnvVars = new Map<
      string,
      Array<{
        name: string;
        value: string;
        secret: boolean;
      }>
    >();
    serviceEnvVars.set("service-1", [
      { name: "OLD", value: "old-value", secret: false },
    ]);

    const deps = {
      createDesiredStateService: () => ({
        listLocalEnvVars: async (_spaceId: string, serviceId: string) =>
          (serviceEnvVars.get(serviceId) ?? []).map((row) => ({
            ...row,
            updated_at: "2026-04-20T00:00:00.000Z",
          })),
        listResourceBindings: async () => [],
        replaceLocalEnvVars: async (params: {
          serviceId?: string;
          workerId?: string;
          variables: Array<{ name: string; value: string; secret?: boolean }>;
        }) => {
          const serviceId = params.serviceId ?? params.workerId;
          if (!serviceId) {
            throw new Error("missing service identifier");
          }
          serviceEnvVars.set(
            serviceId,
            params.variables.map((variable) => ({
              name: variable.name,
              value: variable.value,
              secret: variable.secret === true,
            })),
          );
        },
      }),
      listServiceConsumes: async () => [],
      replaceServiceConsumes: async () => [],
      createServiceBinding: async () => undefined,
      deleteServiceBinding: async () => undefined,
    };

    const snapshot = await captureManagedWorkloadDesiredState(
      {
        DB: {} as never,
      } as never,
      {
        spaceId: "space-1",
        serviceId: "service-1",
        serviceName: "demo:web",
      },
      deps,
    );

    assertEquals(snapshot.localEnvVars, [
      { name: "OLD", value: "old-value", secret: false },
    ]);

    serviceEnvVars.set("service-1", [
      { name: "NEW", value: "new-value", secret: false },
    ]);

    await restoreManagedWorkloadDesiredState(
      {
        DB: {} as never,
      } as never,
      snapshot,
      deps,
    );

    assertEquals(serviceEnvVars.get("service-1"), [
      { name: "OLD", value: "old-value", secret: false },
    ]);
  },
);
