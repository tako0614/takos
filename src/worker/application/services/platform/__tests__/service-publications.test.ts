import { test } from "bun:test";
import { assertEquals, assertRejects, assertThrows } from "@takos/test/assert";

import {
  assertServiceGraphPublicationPrerequisites,
  canonicalPublicationType,
  normalizePublicationDefinition,
  normalizeServiceConsumes,
  publicationAllowedFields,
  publicationOutputContract,
  replaceServiceGraphPublications,
  resolveConsumeOutputEnvName,
  resolveRoutePublication,
  SERVICE_GRAPH_CAPABILITIES,
} from "../service-publications.ts";
import { toPublicationRecord } from "../service-publications-db.ts";
import { publications, serviceConsumes } from "../../../../infra/db/index.ts";
import type { Env } from "../../../../shared/types/index.ts";

type PublicationTestRow = {
  id: string;
  accountId: string;
  groupId: string | null;
  ownerServiceId: string | null;
  sourceType: string;
  name: string;
  catalogName: string | null;
  publicationType: string;
  specJson: string;
  resolvedJson: string;
  status: string;
  createdAt: string;
  updatedAt: string;
};

function makePublicationRow(
  publication: {
    name: string;
    publisher: string;
    type: string;
    outputs?: Record<
      string,
      { kind?: "url" | "string" | "secret"; routeRef?: string }
    >;
    spec?: Record<string, unknown>;
  },
  resolved: Record<string, string> = {},
): PublicationTestRow {
  return {
    id: `pub_${publication.name}`,
    accountId: "space_1",
    groupId: publication.publisher === "takos" ? null : "group_other",
    ownerServiceId: publication.publisher === "takos" ? null : "svc_other",
    sourceType: publication.publisher === "takos" ? "api" : "service_graph",
    name: publication.name,
    catalogName: publication.publisher === "takos" ? "takos" : null,
    publicationType: publication.type,
    specJson: JSON.stringify(publication),
    resolvedJson: JSON.stringify(resolved),
    status: "active",
    createdAt: "2026-04-18T00:00:00.000Z",
    updatedAt: "2026-04-18T00:00:00.000Z",
  };
}

function makePublicationDb(row: PublicationTestRow | null) {
  return {
    select: () => ({
      from: () => ({
        where: () => ({
          get: () => row,
          all: () => (row ? [row] : []),
          orderBy: () => ({
            all: () => (row ? [row] : []),
          }),
        }),
      }),
    }),
    insert: () => ({}),
    update: () => ({}),
    delete: () => ({}),
  };
}

function makePublicationEnv(row: PublicationTestRow | null): Pick<Env, "DB"> {
  return { DB: makePublicationDb(row) } as unknown as Pick<Env, "DB">;
}

test("service publications reject Takos publisher and keep route type open-ended", () => {
  assertThrows(
    () =>
      normalizePublicationDefinition({
        name: "custom-type",
        publisher: "takos",
        type: "custom-sharing-type",
        spec: {},
      }),
    Error,
    "uses reserved publisher 'takos'",
  );
  assertThrows(
    () =>
      normalizePublicationDefinition({
        name: "shared-db",
        publisher: "takos",
        type: "resource",
        spec: { resource: "notes-db" },
      }),
    Error,
    "uses reserved publisher 'takos'",
  );
  assertThrows(
    () =>
      normalizePublicationDefinition({
        name: "notes-oauth",
        publisher: "takos",
        type: "oauth-client",
        spec: {
          redirectUris: ["https://example.com/callback"],
          scopes: ["threads:read"],
        },
      }),
    Error,
    "uses reserved publisher 'takos'",
  );

  assertEquals(
    normalizePublicationDefinition({
      name: "custom-route",
      publisher: "web",
      type: "com.example.CustomSurface",
      outputs: { url: { kind: "url", routeRef: "custom" } },
      display: { title: " Custom route " },
      spec: {
        mode: "panel",
      },
    }),
    {
      name: "custom-route",
      publisher: "web",
      type: "com.example.CustomSurface",
      outputs: { url: { kind: "url", routeRef: "custom" } },
      display: { title: " Custom route " },
      spec: {
        mode: "panel",
      },
    },
  );
});

test("publication type canonicalization preserves service graph capability tokens", () => {
  assertEquals(
    canonicalPublicationType(SERVICE_GRAPH_CAPABILITIES.mcpServer),
    SERVICE_GRAPH_CAPABILITIES.mcpServer,
  );
  assertEquals(
    canonicalPublicationType("com.example.custom"),
    "com.example.custom",
  );
});

test("api Service Graph exports can be restored without route refs", () => {
  const row = makePublicationRow(
    {
      name: "storage.filesystem",
      publisher: "service-graph",
      type: SERVICE_GRAPH_CAPABILITIES.storageFilesystem,
      outputs: { url: { kind: "url" } },
      spec: {
        scopes: { read: ["files:read"], write: ["files:write"] },
      },
    },
    {
      url: "https://takos.example/api/spaces/space_1/storage",
    },
  );
  row.groupId = null;
  row.ownerServiceId = null;
  row.sourceType = "api";
  row.publicationType = SERVICE_GRAPH_CAPABILITIES.storageFilesystem;

  const record = toPublicationRecord(row as never);

  assertEquals(record.name, "storage.filesystem");
  assertEquals(
    record.publicationType,
    SERVICE_GRAPH_CAPABILITIES.storageFilesystem,
  );
  assertEquals(record.outputs, [
    {
      name: "url",
      defaultEnv: "PUBLICATION_STORAGE_FILESYSTEM_URL",
      secret: false,
      kind: "url",
    },
  ]);
  assertEquals(
    record.resolved.url,
    "https://takos.example/api/spaces/space_1/storage",
  );
});

test("publication prerequisites allow built-in Service Graph consumes without catalog rows", async () => {
  await assertServiceGraphPublicationPrerequisites(makePublicationEnv(null), {
    spaceId: "space_1",
    manifest: {
      compute: {
        web: {
          kind: "worker",
          consume: [
            {
              publication: "storage.filesystem",
              inject: { defaults: true },
            },
          ],
        },
      },
    },
  });
});

test("service consumes normalize aliases and reject duplicates", () => {
  assertEquals(
    normalizeServiceConsumes([
      {
        publication: "shared-db",
        inject: {
          env: {
            endpoint: "primary_database_url",
          },
        },
      },
    ]),
    [
      {
        publication: "shared-db",
        inject: {
          env: {
            endpoint: "PRIMARY_DATABASE_URL",
          },
        },
      },
    ],
  );

  assertThrows(
    () =>
      normalizeServiceConsumes([
        { publication: "shared-db" },
        { publication: "shared-db" },
      ]),
    Error,
    "duplicate local consume name",
  );
});

test("service consume env injection resolves aliases with uppercase normalization", () => {
  const output = {
    name: "endpoint",
    defaultEnv: "publication_search_url",
  };
  const first = resolveConsumeOutputEnvName(
    {
      inject: { env: { endpoint: "primary_database_url" } },
    },
    output,
  );
  const second = resolveConsumeOutputEnvName(
    {
      inject: { env: { endpoint: "PRIMARY_DATABASE_URL" } },
    },
    output,
  );

  assertEquals(first, "PRIMARY_DATABASE_URL");
  assertEquals(second, "PRIMARY_DATABASE_URL");
  assertEquals(first, second);
});

test("service publication output contracts are stable", () => {
  assertEquals(
    publicationOutputContract({
      name: "mcp-search",
      publisher: "web",
      type: "com.example.McpEndpoint",
      outputs: { url: { kind: "url", routeRef: "mcp" } },
    }),
    [
      {
        name: "url",
        defaultEnv: "PUBLICATION_MCP_SEARCH_URL",
        secret: false,
        kind: "url",
      },
    ],
  );
  assertEquals(
    publicationOutputContract({
      name: "search-metrics",
      publisher: "web",
      type: "com.example.MetricsEndpoint",
      outputs: {
        ingest: { kind: "url", routeRef: "metrics" },
      },
    }),
    [
      {
        name: "ingest",
        defaultEnv: "PUBLICATION_SEARCH_METRICS_INGEST_URL",
        secret: false,
        kind: "url",
      },
    ],
  );
});

test("route publications resolve URLs from the group hostname", () => {
  const resolved = resolveRoutePublication(
    {
      name: "search",
      publisher: "web",
      type: "protocol.mcp.server",
      outputs: { url: { kind: "url", routeRef: "mcp" } },
    },
    {
      groupId: "group_1",
      groupName: "docs",
      backend: "local",
      env: "default",
      updatedAt: "2026-04-18T00:00:00.000Z",
      resources: {},
      routes: {},
      workloads: {
        web: {
          serviceId: "svc_web",
          name: "web",
          category: "worker",
          status: "deployed",
          hostname: "legacy-web.apps.example",
          routeRef: "web-route-ref",
          updatedAt: "2026-04-18T00:00:00.000Z",
        },
      },
    },
    [{ id: "mcp", target: "web", path: "/mcp" }],
    { groupHostname: "space-docs.apps.example" },
  );

  assertEquals(resolved, {
    ownerServiceId: "svc_web",
    resolved: {
      url: "https://space-docs.apps.example/mcp",
    },
  });
});

test("publication prerequisites allow external catalog route consumes", async () => {
  await assertServiceGraphPublicationPrerequisites(
    makePublicationEnv(
      makePublicationRow(
        {
          name: "external-search",
          publisher: "api",
          type: "com.example.McpEndpoint",
          outputs: { url: { kind: "url", routeRef: "mcp" } },
        },
        { url: "https://api.example/mcp" },
      ),
    ),
    {
      spaceId: "space_1",
      manifest: {
        compute: {
          web: {
            kind: "worker",
            consume: [{ publication: "external-search" }],
          },
        },
      },
    },
  );
});

test("publication prerequisites validate aliases for external catalog route consumes", async () => {
  const env = makePublicationEnv(
    makePublicationRow(
      {
        name: "external-search",
        publisher: "api",
        type: "com.example.McpEndpoint",
        outputs: { url: { kind: "url", routeRef: "mcp" } },
      },
      { url: "https://api.example/mcp" },
    ),
  );

  await assertServiceGraphPublicationPrerequisites(env, {
    spaceId: "space_1",
    manifest: {
      compute: {
        web: {
          kind: "worker",
          consume: [
            {
              publication: "external-search",
              inject: { env: { url: "SEARCH_URL" } },
            },
          ],
        },
      },
    },
  });

  await assertRejects(
    () =>
      assertServiceGraphPublicationPrerequisites(env, {
        spaceId: "space_1",
        manifest: {
          compute: {
            web: {
              kind: "worker",
              consume: [
                {
                  publication: "external-search",
                  inject: { env: { endpoint: "SEARCH_ENDPOINT" } },
                },
              ],
            },
          },
        },
      }),
    Error,
    "maps unknown output 'endpoint'",
  );
});

test("publication prerequisites allow same-manifest consumes before catalog write", async () => {
  await assertServiceGraphPublicationPrerequisites(makePublicationEnv(null), {
    spaceId: "space_1",
    manifest: {
      publish: [
        {
          name: "search",
          publisher: "web",
          type: "com.example.McpEndpoint",
          outputs: { url: { kind: "url", routeRef: "mcp" } },
        },
      ],
      compute: {
        web: {
          kind: "worker",
          consume: [{ publication: "search" }],
        },
      },
    },
  });
});

test("publication prerequisites require a group hostname for same-manifest route consumes", async () => {
  await assertRejects(
    () =>
      assertServiceGraphPublicationPrerequisites(makePublicationEnv(null), {
        spaceId: "space_1",
        groupId: "group_1",
        manifest: {
          publish: [
            {
              name: "search",
              publisher: "web",
              type: "com.example.McpEndpoint",
              outputs: { url: { kind: "url", routeRef: "mcp" } },
            },
          ],
          compute: {
            web: {
              kind: "worker",
              consume: [{ publication: "search" }],
            },
          },
        },
      }),
    Error,
    "consume references same-manifest route publication 'search' but the group hostname is unavailable",
  );
});

test("publication prerequisites reject missing catalog consumes", async () => {
  await assertRejects(
    () =>
      assertServiceGraphPublicationPrerequisites(makePublicationEnv(null), {
        spaceId: "space_1",
        manifest: {
          compute: {
            web: {
              kind: "worker",
              consume: [{ publication: "missing" }],
            },
          },
        },
      }),
    Error,
    "consume references unknown publication 'missing' in this space",
  );
});

test("publication prerequisites reject unknown aliases from catalog metadata", async () => {
  await assertRejects(
    () =>
      assertServiceGraphPublicationPrerequisites(
        makePublicationEnv(
          makePublicationRow(
            {
              name: "search",
              publisher: "web",
              type: "protocol.mcp.server",
              outputs: { url: { kind: "url", routeRef: "mcp" } },
            },
            { url: "https://web.example/mcp" },
          ),
        ),
        {
          spaceId: "space_1",
          manifest: {
            compute: {
              web: {
                kind: "worker",
                consume: [
                  {
                    publication: "search",
                    inject: { env: { nope: "NOPE" } },
                  },
                ],
              },
            },
          },
        },
      ),
    Error,
    "maps unknown output 'nope'",
  );
});

test("service publication allowed fields use route publication contract", () => {
  assertEquals(
    Array.from(
      publicationAllowedFields({
        name: "notes",
        publisher: "web",
        type: "com.example.McpEndpoint",
        outputs: { url: { kind: "url", routeRef: "mcp" } },
      }),
    ).sort(),
    ["auth", "display", "name", "outputs", "publisher", "spec", "type"],
  );
});

test("service publications allow same publication name in different groups", async () => {
  const rows: PublicationTestRow[] = [
    makePublicationRow(
      {
        name: "shared-name",
        publisher: "other-web",
        type: "protocol.mcp.server",
        outputs: { url: { kind: "url", routeRef: "mcp" } },
      },
      { url: "https://other.example/mcp" },
    ),
  ];
  const env = {
    DB: {
      select: () => ({
        from: (table: unknown) => ({
          where: () => ({
            all: () => (table === publications ? rows : []),
            orderBy: () => ({
              all: () => (table === publications ? rows : []),
            }),
          }),
        }),
      }),
      insert: (table: unknown) => ({
        values: (values: PublicationTestRow) => ({
          run: () => {
            if (table === publications) rows.push(values);
          },
        }),
      }),
      update: () => ({
        set: () => ({
          where: () => ({ run: () => undefined }),
        }),
      }),
      delete: () => ({}),
    } as never,
    ENCRYPTION_KEY: "test-key",
    ADMIN_DOMAIN: "admin.example.test",
    TENANT_BASE_DOMAIN: "",
  };

  await replaceServiceGraphPublications(env, {
    spaceId: "space_1",
    groupId: "group_current",
    manifest: {
      routes: [{ id: "mcp", target: "web", path: "/mcp" }],
      publish: [
        {
          name: "shared-name",
          publisher: "web",
          type: "protocol.mcp.server",
          outputs: { url: { kind: "url", routeRef: "mcp" } },
        },
      ],
    },
    observedState: {
      groupId: "group_current",
      groupName: "current",
      backend: "local",
      env: "default",
      updatedAt: "2026-04-18T00:00:00.000Z",
      resources: {},
      routes: {},
      workloads: {
        web: {
          serviceId: "svc_web",
          name: "web",
          category: "worker",
          status: "deployed",
          hostname: "web.example.test",
          routeRef: "web-route-ref",
          updatedAt: "2026-04-18T00:00:00.000Z",
        },
      },
    },
  });

  assertEquals(
    rows.some((row) => row.groupId === "group_current"),
    true,
  );
});

test("service publications reject manifest removal while still consumed", async () => {
  const row = {
    ...makePublicationRow(
      {
        name: "shared-api",
        publisher: "api",
        type: "protocol.mcp.server",
        outputs: { url: { kind: "url", routeRef: "mcp" } },
      },
      { url: "https://api.example/mcp" },
    ),
    groupId: "group_current",
    ownerServiceId: "svc_api",
    sourceType: "service_graph",
  };
  const env = {
    DB: {
      select: () => ({
        from: (table: unknown) => ({
          where: () => ({
            all: () => {
              if (table === publications) return [row];
              if (table !== serviceConsumes) return [];
              return [
                {
                  id: "consume_1",
                  accountId: "space_1",
                  serviceId: "svc_web",
                  publicationName: "shared-api",
                  configJson: JSON.stringify({ publication: "shared-api" }),
                  stateJson: "{}",
                  createdAt: "2026-04-18T00:00:00.000Z",
                  updatedAt: "2026-04-18T00:00:00.000Z",
                },
              ];
            },
            orderBy: () => ({
              all: () => [row],
            }),
            limit: () => ({
              get: () => ({ id: "consume_1" }),
            }),
          }),
        }),
      }),
      insert: () => ({
        values: () => {
          throw new Error("insert should not run");
        },
      }),
      update: () => ({
        set: () => {
          throw new Error("update should not run");
        },
      }),
      delete: () => {
        throw new Error("delete should not run while consumed");
      },
    } as never,
    ENCRYPTION_KEY: "test-key",
    ADMIN_DOMAIN: "admin.example.test",
    TENANT_BASE_DOMAIN: "",
  };

  await assertRejects(
    () =>
      replaceServiceGraphPublications(env, {
        spaceId: "space_1",
        groupId: "group_current",
        manifest: { publish: [], routes: [] },
        observedState: {
          groupId: "group_current",
          groupName: "current",
          backend: "local",
          env: "default",
          updatedAt: "2026-04-18T00:00:00.000Z",
          resources: {},
          routes: {},
          workloads: {},
        },
      }),
    Error,
    "publication 'shared-api' is still consumed by one or more services",
  );
});

test("service publications preflight consumed removals before manifest writes", async () => {
  const row = {
    ...makePublicationRow(
      {
        name: "shared-api",
        publisher: "api",
        type: "protocol.mcp.server",
        outputs: { url: { kind: "url", routeRef: "mcp" } },
      },
      { url: "https://api.example/mcp" },
    ),
    groupId: "group_current",
    ownerServiceId: "svc_api",
    sourceType: "service_graph",
  };
  let writeCount = 0;
  const env = {
    DB: {
      select: () => ({
        from: (table: unknown) => ({
          where: () => ({
            all: () => {
              if (table === publications) return [row];
              if (table !== serviceConsumes) return [];
              return [
                {
                  id: "consume_1",
                  accountId: "space_1",
                  serviceId: "svc_web",
                  publicationName: "shared-api",
                  configJson: JSON.stringify({ publication: "shared-api" }),
                  stateJson: "{}",
                  createdAt: "2026-04-18T00:00:00.000Z",
                  updatedAt: "2026-04-18T00:00:00.000Z",
                },
              ];
            },
            orderBy: () => ({
              all: () => [row],
            }),
            limit: () => ({
              get: () => ({ id: "consume_1" }),
            }),
          }),
        }),
      }),
      insert: () => ({
        values: () => {
          writeCount++;
          throw new Error("insert should not run before removal preflight");
        },
      }),
      update: () => ({
        set: () => {
          writeCount++;
          throw new Error("update should not run before removal preflight");
        },
      }),
      delete: () => {
        writeCount++;
        throw new Error("delete should not run while consumed");
      },
    } as never,
    ENCRYPTION_KEY: "test-key",
    ADMIN_DOMAIN: "admin.example.test",
    TENANT_BASE_DOMAIN: "",
  };

  await assertRejects(
    () =>
      replaceServiceGraphPublications(env, {
        spaceId: "space_1",
        groupId: "group_current",
        manifest: {
          publish: [
            {
              name: "new-api",
              publisher: "web",
              type: "protocol.mcp.server",
              outputs: { url: { kind: "url", routeRef: "mcp" } },
            },
          ],
          routes: [{ id: "mcp", target: "web", path: "/mcp" }],
        },
        observedState: {
          groupId: "group_current",
          groupName: "current",
          backend: "local",
          env: "default",
          updatedAt: "2026-04-18T00:00:00.000Z",
          resources: {},
          routes: {},
          workloads: {
            web: {
              serviceId: "svc_web",
              name: "web",
              category: "worker",
              status: "deployed",
              hostname: "web.example.test",
              routeRef: "web-route-ref",
              updatedAt: "2026-04-18T00:00:00.000Z",
            },
          },
        },
      }),
    Error,
    "publication 'shared-api' is still consumed by one or more services",
  );
  assertEquals(writeCount, 0);
});
