import { assertEquals, assertRejects, assertThrows } from "jsr:@std/assert";

import {
  assertManifestPublicationPrerequisites,
  listPublicationKinds,
  normalizePublicationDefinition,
  normalizeServiceConsumes,
  publicationAllowedFields,
  publicationOutputContract,
  replaceManifestPublications,
  resolveConsumeOutputEnvName,
  resolveOAuthIssuerUrl,
  resolveRoutePublication,
  upsertApiPublication,
} from "../service-publications.ts";
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
    path?: string;
    spec?: Record<string, unknown>;
  },
  resolved: Record<string, string> = {},
): PublicationTestRow {
  return {
    id: `pub_${publication.name}`,
    accountId: "space_1",
    groupId: publication.publisher === "takos" ? null : "group_other",
    ownerServiceId: publication.publisher === "takos" ? null : "svc_other",
    sourceType: publication.publisher === "takos" ? "api" : "manifest",
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

function makePublicationConflictEnv(
  row: PublicationTestRow,
): Pick<Env, "DB" | "ENCRYPTION_KEY" | "ADMIN_DOMAIN" | "TENANT_BASE_DOMAIN"> {
  return {
    DB: {
      select: () => ({
        from: () => ({
          where: () => ({
            get: () => row,
            orderBy: () => ({
              all: () => [],
            }),
          }),
        }),
      }),
      insert: () => ({
        values: () => {
          throw new Error("insert should not run for ownership conflict");
        },
      }),
      update: () => ({
        set: () => {
          throw new Error("update should not run for ownership conflict");
        },
      }),
      delete: () => ({}),
    } as never,
    ENCRYPTION_KEY: "test-key",
    ADMIN_DOMAIN: "admin.example.test",
    TENANT_BASE_DOMAIN: "",
  };
}

Deno.test("service publications normalize Takos grants via spec", () => {
  const takosApi = normalizePublicationDefinition({
    name: "takos-api",
    publisher: "takos",
    type: "api-key",
    spec: {
      scopes: ["files:read", " files:read ", "files:write"],
    },
  });
  const oauthClient = normalizePublicationDefinition({
    name: "notes-oauth",
    publisher: "takos",
    type: "oauth-client",
    spec: {
      redirectUris: [
        "https://example.com/callback",
        "https://example.com/callback",
      ],
      scopes: ["threads:read", "threads:read"],
      metadata: {
        logoUri: "https://example.com/logo.png",
      },
    },
  });

  assertEquals(takosApi.spec, { scopes: ["files:read", "files:write"] });
  assertEquals(oauthClient.spec, {
    redirectUris: ["https://example.com/callback"],
    scopes: ["threads:read"],
    metadata: {
      logoUri: "https://example.com/logo.png",
    },
  });
});

Deno.test("service publications reject insecure oauth redirect uris", () => {
  assertThrows(
    () =>
      normalizePublicationDefinition({
        name: "bad-oauth",
        publisher: "takos",
        type: "oauth-client",
        spec: {
          redirectUris: ["http://example.com/callback"],
          scopes: ["threads:read"],
        },
      }),
    Error,
    "must use HTTPS",
  );
});

Deno.test("service publications keep Takos type strict and route type open-ended", () => {
  assertThrows(
    () =>
      normalizePublicationDefinition({
        name: "custom-type",
        publisher: "takos",
        type: "custom-sharing-type",
        spec: {},
      }),
    Error,
    "publisher/type is unsupported: takos/custom-sharing-type",
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
    "publisher/type is unsupported: takos/resource",
  );

  assertEquals(
    normalizePublicationDefinition({
      name: "custom-route",
      publisher: "web",
      type: "com.example.CustomSurface",
      path: "/custom",
      title: " Custom route ",
      spec: {
        mode: "panel",
      },
    }),
    {
      name: "custom-route",
      publisher: "web",
      type: "com.example.CustomSurface",
      path: "/custom",
      title: "Custom route",
      spec: {
        mode: "panel",
      },
    },
  );
});

Deno.test("service consumes normalize aliases and reject duplicates", () => {
  assertEquals(
    normalizeServiceConsumes([
      {
        publication: "shared-db",
        env: {
          endpoint: "primary_database_url",
        },
      },
    ]),
    [{
      publication: "shared-db",
      env: {
        endpoint: "PRIMARY_DATABASE_URL",
      },
    }],
  );

  assertThrows(
    () =>
      normalizeServiceConsumes([
        { publication: "shared-db" },
        { publication: "shared-db" },
      ]),
    Error,
    "duplicate publication reference",
  );
});

Deno.test("service consume env injection resolves aliases with uppercase normalization", () => {
  const output = {
    name: "endpoint",
    defaultEnv: "publication_search_url",
  };
  const first = resolveConsumeOutputEnvName(
    {
      env: { endpoint: "primary_database_url" },
    },
    output,
  );
  const second = resolveConsumeOutputEnvName(
    {
      env: { endpoint: "PRIMARY_DATABASE_URL" },
    },
    output,
  );

  assertEquals(first, "PRIMARY_DATABASE_URL");
  assertEquals(second, "PRIMARY_DATABASE_URL");
  assertEquals(first, second);
});

Deno.test("service publication output contracts are stable", () => {
  assertEquals(
    publicationOutputContract({
      name: "mcp-search",
      publisher: "web",
      type: "com.example.McpEndpoint",
      path: "/mcp",
    }),
    [{
      name: "url",
      defaultEnv: "PUBLICATION_MCP_SEARCH_URL",
      secret: false,
    }],
  );
  assertEquals(
    publicationOutputContract({
      name: "takos-api",
      publisher: "takos",
      type: "api-key",
      spec: { scopes: ["files:read"] },
    }),
    [
      {
        name: "endpoint",
        defaultEnv: "PUBLICATION_TAKOS_API_ENDPOINT",
        secret: false,
      },
      {
        name: "apiKey",
        defaultEnv: "PUBLICATION_TAKOS_API_API_KEY",
        secret: true,
      },
    ],
  );
  assertEquals(
    publicationOutputContract({
      name: "notes-oauth",
      publisher: "takos",
      type: "oauth-client",
      spec: {
        redirectUris: ["https://example.com/callback"],
        scopes: ["threads:read"],
      },
    }),
    [
      {
        name: "clientId",
        defaultEnv: "PUBLICATION_NOTES_OAUTH_CLIENT_ID",
        secret: false,
      },
      {
        name: "clientSecret",
        defaultEnv: "PUBLICATION_NOTES_OAUTH_CLIENT_SECRET",
        secret: true,
      },
      {
        name: "issuer",
        defaultEnv: "PUBLICATION_NOTES_OAUTH_ISSUER",
        secret: false,
      },
    ],
  );
  assertEquals(
    resolveOAuthIssuerUrl({ ADMIN_DOMAIN: "takos.example.com" }),
    "https://takos.example.com",
  );
});

Deno.test("route publications resolve URLs from the group hostname", () => {
  const resolved = resolveRoutePublication(
    {
      name: "search",
      publisher: "web",
      type: "McpServer",
      path: "/mcp",
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
    [{ target: "web", path: "/mcp" }],
    { groupHostname: "space-docs.apps.example" },
  );

  assertEquals(resolved, {
    ownerServiceId: "svc_web",
    resolved: {
      url: "https://space-docs.apps.example/mcp",
    },
  });
});

Deno.test("publication prerequisites allow external catalog route consumes", async () => {
  await assertManifestPublicationPrerequisites(
    makePublicationEnv(
      makePublicationRow({
        name: "external-search",
        publisher: "api",
        type: "com.example.McpEndpoint",
        path: "/mcp",
      }, { url: "https://api.example/mcp" }),
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

Deno.test("publication prerequisites validate aliases for external catalog route consumes", async () => {
  const env = makePublicationEnv(
    makePublicationRow({
      name: "external-search",
      publisher: "api",
      type: "com.example.McpEndpoint",
      path: "/mcp",
    }, { url: "https://api.example/mcp" }),
  );

  await assertManifestPublicationPrerequisites(env, {
    spaceId: "space_1",
    manifest: {
      compute: {
        web: {
          kind: "worker",
          consume: [{
            publication: "external-search",
            env: { url: "SEARCH_URL" },
          }],
        },
      },
    },
  });

  await assertRejects(
    () =>
      assertManifestPublicationPrerequisites(env, {
        spaceId: "space_1",
        manifest: {
          compute: {
            web: {
              kind: "worker",
              consume: [{
                publication: "external-search",
                env: { endpoint: "SEARCH_ENDPOINT" },
              }],
            },
          },
        },
      }),
    Error,
    "maps unknown output 'endpoint'",
  );
});

Deno.test("publication prerequisites allow same-manifest consumes before catalog write", async () => {
  await assertManifestPublicationPrerequisites(makePublicationEnv(null), {
    spaceId: "space_1",
    manifest: {
      publish: [{
        name: "search",
        publisher: "web",
        type: "com.example.McpEndpoint",
        path: "/mcp",
      }],
      compute: {
        web: {
          kind: "worker",
          consume: [{ publication: "search" }],
        },
      },
    },
  });
});

Deno.test("publication prerequisites reject missing catalog consumes", async () => {
  await assertRejects(
    () =>
      assertManifestPublicationPrerequisites(
        makePublicationEnv(null),
        {
          spaceId: "space_1",
          manifest: {
            compute: {
              web: {
                kind: "worker",
                consume: [{ publication: "missing" }],
              },
            },
          },
        },
      ),
    Error,
    "consume references unknown publication 'missing' in this space",
  );
});

Deno.test("publication prerequisites reject unknown aliases from catalog metadata", async () => {
  await assertRejects(
    () =>
      assertManifestPublicationPrerequisites(
        makePublicationEnv(
          makePublicationRow({
            name: "takos-api",
            publisher: "takos",
            type: "api-key",
            spec: { scopes: ["files:read"] },
          }),
        ),
        {
          spaceId: "space_1",
          manifest: {
            compute: {
              web: {
                kind: "worker",
                consume: [{
                  publication: "takos-api",
                  env: { nope: "NOPE" },
                }],
              },
            },
          },
        },
      ),
    Error,
    "maps unknown output 'nope'",
  );
});

Deno.test("service publication discovery lists supported Takos publisher types", () => {
  const kinds = listPublicationKinds().sort((a, b) =>
    `${a.publisher}:${a.type}`.localeCompare(`${b.publisher}:${b.type}`)
  );

  assertEquals(
    kinds.map((entry) => `${entry.publisher}:${entry.type}`),
    [
      "takos:api-key",
      "takos:oauth-client",
    ],
  );
  assertEquals(
    kinds.find((entry) => entry.type === "api-key")?.specFields,
    [{ name: "scopes", required: true, type: "string[]" }],
  );
  assertEquals(
    Array.from(publicationAllowedFields({
      name: "takos-api",
      publisher: "takos",
      type: "api-key",
    })).sort(),
    ["name", "publisher", "spec", "type"],
  );
  assertEquals(
    Array.from(publicationAllowedFields({
      name: "notes",
      publisher: "web",
      type: "com.example.McpEndpoint",
      path: "/mcp",
    })).sort(),
    ["name", "path", "publisher", "spec", "title", "type"],
  );
});

Deno.test("service publications reject API route publication writes clearly", async () => {
  await assertRejects(
    () =>
      upsertApiPublication({} as Parameters<typeof upsertApiPublication>[0], {
        spaceId: "space_1",
        publication: {
          name: "route-publication",
          publisher: "web",
          type: "com.example.Route",
          path: "missing-leading-slash",
        },
      }),
    Error,
    "Route publications cannot be written through PUT /api/publications/:name",
  );
});

Deno.test("service publications reject API overwrite of manifest-owned publication", async () => {
  await assertRejects(
    () =>
      upsertApiPublication(
        makePublicationConflictEnv(
          makePublicationRow({
            name: "shared-name",
            publisher: "web",
            type: "McpServer",
            path: "/mcp",
          }, { url: "https://web.example/mcp" }),
        ),
        {
          spaceId: "space_1",
          publication: {
            name: "shared-name",
            publisher: "takos",
            type: "api-key",
            spec: { scopes: ["files:read"] },
          },
        },
      ),
    Error,
    "already exists in this space and is owned by manifest group 'group_other'",
  );
});

Deno.test("service publications reject manifest overwrite of another group publication", async () => {
  await assertRejects(
    () =>
      replaceManifestPublications(
        makePublicationConflictEnv(
          makePublicationRow({
            name: "shared-name",
            publisher: "other-web",
            type: "McpServer",
            path: "/mcp",
          }, { url: "https://other.example/mcp" }),
        ),
        {
          spaceId: "space_1",
          groupId: "group_current",
          manifest: {
            routes: [{ target: "web", path: "/mcp" }],
            publish: [{
              name: "shared-name",
              publisher: "web",
              type: "McpServer",
              path: "/mcp",
            }],
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
        },
      ),
    Error,
    "already exists in this space and is owned by manifest group 'group_other'",
  );
});
