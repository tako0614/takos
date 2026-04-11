import { assertEquals, assertThrows } from "jsr:@std/assert";

import {
  listPublicationProviders,
  normalizePublicationDefinition,
  normalizeServiceConsumes,
  publicationAllowedFields,
  publicationOutputContract,
  resolveOAuthIssuerUrl,
} from "../service-publications.ts";

Deno.test("service publications normalize Takos providers via spec", () => {
  const takosApi = normalizePublicationDefinition({
    name: "takos-api",
    provider: "takos",
    kind: "api",
    spec: {
      scopes: ["files:read", " files:read ", "files:write"],
    },
  });
  const takosSql = normalizePublicationDefinition({
    name: "shared-db",
    provider: "takos",
    kind: "sql",
    spec: {
      resource: " notes-db ",
      permission: "WRITE",
    },
  });
  const oauthClient = normalizePublicationDefinition({
    name: "notes-oauth",
    provider: "takos",
    kind: "oauth-client",
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
  assertEquals(takosSql.spec, {
    resource: "notes-db",
    permission: "write",
  });
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
        provider: "takos",
        kind: "oauth-client",
        spec: {
          redirectUris: ["http://example.com/callback"],
          scopes: ["threads:read"],
        },
      }),
    Error,
    "must use HTTPS",
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

Deno.test("service publication output contracts are stable", () => {
  assertEquals(
    publicationOutputContract({
      name: "mcp-browser",
      type: "McpServer",
      path: "/mcp",
    }),
    [{
      name: "url",
      defaultEnv: "PUBLICATION_MCP_BROWSER_URL",
      secret: false,
    }],
  );
  assertEquals(
    publicationOutputContract({
      name: "takos-api",
      provider: "takos",
      kind: "api",
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
      name: "shared-db",
      provider: "takos",
      kind: "sql",
      spec: { resource: "notes-db" },
    }),
    [
      {
        name: "endpoint",
        defaultEnv: "PUBLICATION_SHARED_DB_ENDPOINT",
        secret: false,
      },
      {
        name: "apiKey",
        defaultEnv: "PUBLICATION_SHARED_DB_API_KEY",
        secret: true,
      },
    ],
  );
  assertEquals(
    publicationOutputContract({
      name: "notes-oauth",
      provider: "takos",
      kind: "oauth-client",
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

Deno.test("service publication provider discovery lists supported kinds", () => {
  const byProviderKind = (
    a: { provider: string; kind: string },
    b: { provider: string; kind: string },
  ) => `${a.provider}:${a.kind}`.localeCompare(`${b.provider}:${b.kind}`);

  assertEquals(
    listPublicationProviders().sort(byProviderKind),
    [
      {
        provider: "takos",
        kind: "analytics-engine",
        specFields: [
          { name: "resource", required: true, type: "string" },
          { name: "permission", required: false, type: "string" },
        ],
        outputs: [
          {
            name: "endpoint",
            defaultEnv: "PUBLICATION_{PUBLICATION}_ENDPOINT",
            secret: false,
          },
          {
            name: "apiKey",
            defaultEnv: "PUBLICATION_{PUBLICATION}_API_KEY",
            secret: true,
          },
        ],
      },
      {
        provider: "takos",
        kind: "api",
        specFields: [{
          name: "scopes",
          required: true,
          type: "string[]",
        }],
        outputs: [
          {
            name: "endpoint",
            defaultEnv: "PUBLICATION_{PUBLICATION}_ENDPOINT",
            secret: false,
          },
          {
            name: "apiKey",
            defaultEnv: "PUBLICATION_{PUBLICATION}_API_KEY",
            secret: true,
          },
        ],
      },
      {
        provider: "takos",
        kind: "key-value",
        specFields: [
          { name: "resource", required: true, type: "string" },
          { name: "permission", required: false, type: "string" },
        ],
        outputs: [
          {
            name: "endpoint",
            defaultEnv: "PUBLICATION_{PUBLICATION}_ENDPOINT",
            secret: false,
          },
          {
            name: "apiKey",
            defaultEnv: "PUBLICATION_{PUBLICATION}_API_KEY",
            secret: true,
          },
        ],
      },
      {
        provider: "takos",
        kind: "object-store",
        specFields: [
          { name: "resource", required: true, type: "string" },
          { name: "permission", required: false, type: "string" },
        ],
        outputs: [
          {
            name: "endpoint",
            defaultEnv: "PUBLICATION_{PUBLICATION}_ENDPOINT",
            secret: false,
          },
          {
            name: "apiKey",
            defaultEnv: "PUBLICATION_{PUBLICATION}_API_KEY",
            secret: true,
          },
        ],
      },
      {
        provider: "takos",
        kind: "oauth-client",
        specFields: [
          { name: "clientName", required: false, type: "string" },
          { name: "redirectUris", required: true, type: "string[]" },
          { name: "scopes", required: true, type: "string[]" },
          { name: "metadata", required: false, type: "object" },
        ],
        outputs: [
          {
            name: "clientId",
            defaultEnv: "PUBLICATION_{PUBLICATION}_CLIENT_ID",
            secret: false,
          },
          {
            name: "clientSecret",
            defaultEnv: "PUBLICATION_{PUBLICATION}_CLIENT_SECRET",
            secret: true,
          },
          {
            name: "issuer",
            defaultEnv: "PUBLICATION_{PUBLICATION}_ISSUER",
            secret: false,
          },
        ],
      },
      {
        provider: "takos",
        kind: "queue",
        specFields: [
          { name: "resource", required: true, type: "string" },
          { name: "permission", required: false, type: "string" },
        ],
        outputs: [
          {
            name: "endpoint",
            defaultEnv: "PUBLICATION_{PUBLICATION}_ENDPOINT",
            secret: false,
          },
          {
            name: "apiKey",
            defaultEnv: "PUBLICATION_{PUBLICATION}_API_KEY",
            secret: true,
          },
        ],
      },
      {
        provider: "takos",
        kind: "sql",
        specFields: [
          { name: "resource", required: true, type: "string" },
          { name: "permission", required: false, type: "string" },
        ],
        outputs: [
          {
            name: "endpoint",
            defaultEnv: "PUBLICATION_{PUBLICATION}_ENDPOINT",
            secret: false,
          },
          {
            name: "apiKey",
            defaultEnv: "PUBLICATION_{PUBLICATION}_API_KEY",
            secret: true,
          },
        ],
      },
      {
        provider: "takos",
        kind: "vector-index",
        specFields: [
          { name: "resource", required: true, type: "string" },
          { name: "permission", required: false, type: "string" },
        ],
        outputs: [
          {
            name: "endpoint",
            defaultEnv: "PUBLICATION_{PUBLICATION}_ENDPOINT",
            secret: false,
          },
          {
            name: "apiKey",
            defaultEnv: "PUBLICATION_{PUBLICATION}_API_KEY",
            secret: true,
          },
        ],
      },
    ].sort(byProviderKind),
  );
  assertEquals(
    Array.from(publicationAllowedFields({
      name: "takos-api",
      provider: "takos",
      kind: "api",
    })).sort(),
    ["kind", "name", "provider", "spec"],
  );
});
