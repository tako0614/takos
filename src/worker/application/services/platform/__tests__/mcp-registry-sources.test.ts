import { expect, test } from "bun:test";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";

import * as schema from "../../../../infra/db/schema.ts";
import type { Database } from "../../../../infra/db/client.ts";
import type { Env, FetchBinding } from "../../../../shared/types/index.ts";
import {
  createMcpRegistrySource,
  deleteMcpRegistrySource,
  listMcpRegistrySources,
  OFFICIAL_MCP_REGISTRY_SOURCE_ID,
  searchMcpRegistrySources,
  updateMcpRegistrySource,
} from "../mcp/registry-sources.ts";

async function freshDb(): Promise<Database> {
  const client = createClient({ url: ":memory:" });
  await client.execute("PRAGMA foreign_keys = OFF");
  await client.executeMultiple(`
    CREATE TABLE accounts (
      id TEXT PRIMARY KEY
    );
    CREATE TABLE mcp_registry_sources (
      id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL,
      name TEXT NOT NULL,
      base_url TEXT NOT NULL,
      source_kind TEXT NOT NULL DEFAULT 'custom',
      auth_type TEXT NOT NULL DEFAULT 'none',
      auth_header_name TEXT,
      auth_secret TEXT,
      enabled INTEGER NOT NULL DEFAULT 1,
      priority INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE UNIQUE INDEX idx_mcp_registry_sources_account_base_url
      ON mcp_registry_sources(account_id, base_url);
  `);
  return drizzle(client, { schema }) as unknown as Database;
}

function registryResponse(servers: unknown[], status = 200): Response {
  return new Response(
    JSON.stringify({ servers, metadata: { count: servers.length } }),
    {
      status,
      headers: { "Content-Type": "application/json" },
    },
  );
}

function envWithEgress(fetch: FetchBinding["fetch"]): Env {
  return {
    ENVIRONMENT: "production",
    ENCRYPTION_KEY: "registry-source-test-encryption-key",
    TAKOS_EGRESS: { fetch },
  } as unknown as Env;
}

test("registry source CRUD keeps the Official source virtual and read-only", async () => {
  const db = await freshDb();
  const env = envWithEgress(async () => registryResponse([]));

  const created = await createMcpRegistrySource(db, env, "space_1", {
    name: "Company Registry",
    baseUrl: "https://registry.company.example/",
    sourceKind: "organization",
    priority: 200,
  });
  expect(created).toMatchObject({
    spaceId: "space_1",
    baseUrl: "https://registry.company.example",
    sourceKind: "organization",
    enabled: true,
    readOnly: false,
    verificationStatus: "not_assessed",
    securityStatus: "not_assessed",
  });

  const listed = await listMcpRegistrySources(db, "space_1");
  expect(listed).toHaveLength(2);
  expect(listed.map((source) => source.id)).toEqual([
    created.id,
    OFFICIAL_MCP_REGISTRY_SOURCE_ID,
  ]);
  expect(listed[1]).toMatchObject({
    spaceId: "space_1",
    sourceKind: "official",
    enabled: true,
    readOnly: true,
    preview: true,
    bestEffort: true,
    securityStatus: "not_assessed",
  });

  const updated = await updateMcpRegistrySource(
    db,
    env,
    "space_1",
    created.id,
    { enabled: false, priority: -20 },
  );
  expect(updated).toMatchObject({ enabled: false, priority: -20 });

  const disabledOfficial = await updateMcpRegistrySource(
    db,
    env,
    "space_1",
    OFFICIAL_MCP_REGISTRY_SOURCE_ID,
    { enabled: false },
  );
  expect(disabledOfficial).toMatchObject({
    id: OFFICIAL_MCP_REGISTRY_SOURCE_ID,
    spaceId: "space_1",
    enabled: false,
    readOnly: true,
  });
  await expect(
    updateMcpRegistrySource(
      db,
      env,
      "space_1",
      OFFICIAL_MCP_REGISTRY_SOURCE_ID,
      { priority: 200 },
    ),
  ).rejects.toThrow("Only the enabled preference");
  await expect(
    deleteMcpRegistrySource(db, "space_1", OFFICIAL_MCP_REGISTRY_SOURCE_ID),
  ).rejects.toThrow("virtual and read-only");

  expect(await deleteMcpRegistrySource(db, "space_1", created.id)).toBe(true);
  expect(await listMcpRegistrySources(db, "space_1")).toHaveLength(1);
});

test("disabling the Official Registry is Workspace-scoped and performs no Official egress", async () => {
  const db = await freshDb();
  let egressCalls = 0;
  const env = envWithEgress(async () => {
    egressCalls += 1;
    return registryResponse([]);
  });

  await updateMcpRegistrySource(
    db,
    env,
    "space_private",
    OFFICIAL_MCP_REGISTRY_SOURCE_ID,
    { enabled: false },
  );

  const privateSources = await listMcpRegistrySources(db, "space_private");
  expect(privateSources).toHaveLength(1);
  expect(privateSources[0]).toMatchObject({ enabled: false, readOnly: true });
  expect((await listMcpRegistrySources(db, "space_other"))[0]).toMatchObject({
    enabled: true,
  });

  const result = await searchMcpRegistrySources(db, env, {
    spaceId: "space_private",
    query: "internal-connector",
  });
  expect(egressCalls).toBe(0);
  expect(result.candidates).toEqual([]);
  expect(result.sourceResults).toEqual([]);
  expect(result.sourceFailures).toEqual([]);
});

test("production Registry sources use the egress-supported default HTTPS port", async () => {
  const db = await freshDb();
  const env = envWithEgress(async () => registryResponse([]));

  await expect(
    createMcpRegistrySource(db, env, "space_1", {
      name: "Unsupported port",
      baseUrl: "https://registry.example.com:8443",
      sourceKind: "custom",
    }),
  ).rejects.toThrow("default HTTPS port");

  const source = await createMcpRegistrySource(db, env, "space_1", {
    name: "Default port",
    baseUrl: "https://registry.example.com:443/root",
    sourceKind: "custom",
  });
  expect(source.baseUrl).toBe("https://registry.example.com/root");
});

test("live Registry search limits upstream concurrency", async () => {
  const db = await freshDb();
  let active = 0;
  let maxActive = 0;
  let calls = 0;
  let releaseFirstWave!: () => void;
  const firstWave = new Promise<void>((resolve) => {
    releaseFirstWave = resolve;
  });
  const env = envWithEgress(async () => {
    active += 1;
    calls += 1;
    maxActive = Math.max(maxActive, active);
    if (calls === 4) releaseFirstWave();
    await firstWave;
    active -= 1;
    return registryResponse([]);
  });

  for (let index = 0; index < 7; index += 1) {
    await createMcpRegistrySource(db, env, "space_1", {
      name: `Registry ${index}`,
      baseUrl: `https://registry-${index}.example.com`,
      sourceKind: "custom",
    });
  }

  await searchMcpRegistrySources(db, env, {
    spaceId: "space_1",
    query: "workspace",
  });
  expect(calls).toBe(8);
  expect(maxActive).toBe(4);
});

test("live Registry search merges endpoint candidates and preserves every source provenance", async () => {
  const db = await freshDb();
  const calls: Array<{
    url: string;
    redirect: RequestRedirect | undefined;
    authorization: string | null;
    cookie: string | null;
  }> = [];
  const env = envWithEgress(async (input, init) => {
    const url = String(input);
    const headers = new Headers(init?.headers);
    calls.push({
      url,
      redirect: init?.redirect,
      authorization: headers.get("authorization"),
      cookie: headers.get("cookie"),
    });
    if (url.startsWith("https://registry.company.example/")) {
      return registryResponse([
        {
          server: {
            name: "com.company/workspace",
            title: "Company Workspace",
            description: "Company-curated metadata",
            version: "2.0.0",
            repository: { url: "https://github.com/company/workspace-mcp" },
            remotes: [
              {
                type: "streamable-http",
                url: "https://connector.example/mcp",
                headers: [{ name: "Authorization", isRequired: true }],
              },
            ],
          },
        },
      ]);
    }
    if (url.startsWith("https://registry.fail.example/")) {
      return registryResponse([], 503);
    }
    return registryResponse([
      {
        server: {
          name: "io.example/workspace",
          title: "Workspace Connector",
          description: "Official Registry metadata",
          version: "1.0.0",
          remotes: [
            {
              type: "streamable-http",
              url: "https://connector.example/mcp",
            },
            {
              type: "streamable-http",
              url: "https://{tenant}.example/mcp",
              variables: { tenant: { isRequired: true } },
            },
            { type: "sse", url: "https://legacy.example/sse" },
          ],
        },
      },
    ]);
  });

  await createMcpRegistrySource(db, env, "space_1", {
    name: "Company Registry",
    baseUrl: "https://registry.company.example",
    sourceKind: "organization",
    priority: 200,
  });
  await createMcpRegistrySource(db, env, "space_1", {
    name: "Failing Registry",
    baseUrl: "https://registry.fail.example",
    sourceKind: "custom",
    priority: 50,
  });

  const result = await searchMcpRegistrySources(db, env, {
    spaceId: "space_1",
    query: "workspace",
  });

  expect(result.candidates).toHaveLength(1);
  expect(result.candidates[0]).toMatchObject({
    name: "com.company/workspace",
    title: "Company Workspace",
    url: "https://connector.example/mcp",
    transport: "streamable-http",
    requiresConfiguration: true,
  });
  expect(
    result.candidates[0]!.provenance.map((source) => ({
      name: source.sourceName,
      server: source.serverName,
      version: source.serverVersion,
    })),
  ).toEqual([
    {
      name: "Company Registry",
      server: "com.company/workspace",
      version: "2.0.0",
    },
    {
      name: "Official MCP Registry",
      server: "io.example/workspace",
      version: "1.0.0",
    },
  ]);
  expect(result.sourceFailures).toEqual([
    expect.objectContaining({
      sourceName: "Failing Registry",
      code: "http_error",
      status: 503,
    }),
  ]);
  expect(result.limitations).toEqual({
    mode: "live_best_effort",
    upstreamSearch: "server_name_substring_only",
    cachedFullTextAggregation: false,
    credentialsSupported: true,
  });
  expect(calls).toHaveLength(3);
  for (const call of calls) {
    const url = new URL(call.url);
    expect(url.pathname.endsWith("/v0.1/servers")).toBe(true);
    expect(url.searchParams.get("search")).toBe("workspace");
    expect(url.searchParams.get("version")).toBe("latest");
    expect(call.redirect).toBe("manual");
    expect(call.authorization).toBeNull();
    expect(call.cookie).toBeNull();
  }
});

test("invalid Registry response is isolated as a per-source failure", async () => {
  const db = await freshDb();
  const env = envWithEgress(
    async () =>
      new Response(JSON.stringify({ servers: [{ not_server: true }] }), {
        headers: { "Content-Type": "application/json" },
      }),
  );

  const result = await searchMcpRegistrySources(db, env, {
    spaceId: "space_1",
    query: "workspace",
  });
  expect(result.candidates).toEqual([]);
  expect(result.sourceFailures).toEqual([
    expect.objectContaining({
      sourceId: OFFICIAL_MCP_REGISTRY_SOURCE_ID,
      code: "invalid_response",
    }),
  ]);
});

test("authenticated Registry search decrypts only for egress and fails closed on host changes", async () => {
  const db = await freshDb();
  const observed: Array<{
    host: string;
    authorization: string | null;
    custom: string | null;
  }> = [];
  const env = envWithEgress(async (input, init) => {
    const url = new URL(String(input));
    const headers = new Headers(init?.headers);
    observed.push({
      host: url.host,
      authorization: headers.get("authorization"),
      custom: headers.get("x-registry-token"),
    });
    return registryResponse([]);
  });

  const bearer = await createMcpRegistrySource(db, env, "space_1", {
    name: "Bearer Registry",
    baseUrl: "https://bearer-registry.example",
    authType: "bearer",
    authSecret: "bearer-secret-value",
  });
  const custom = await createMcpRegistrySource(db, env, "space_1", {
    name: "Header Registry",
    baseUrl: "https://header-registry.example",
    authType: "header",
    authHeaderName: "X-Registry-Token",
    authSecret: "header-secret-value",
  });

  expect(bearer.credentialConfigured).toBe(true);
  expect(bearer.authSecretCiphertext).not.toContain("bearer-secret-value");
  expect(custom.authSecretCiphertext).not.toContain("header-secret-value");
  await searchMcpRegistrySources(db, env, {
    spaceId: "space_1",
    query: "docs",
  });

  expect(
    observed.find((entry) => entry.host === "bearer-registry.example"),
  ).toMatchObject({
    authorization: "Bearer bearer-secret-value",
    custom: null,
  });
  expect(
    observed.find((entry) => entry.host === "header-registry.example"),
  ).toMatchObject({
    authorization: null,
    custom: "header-secret-value",
  });
  await expect(
    updateMcpRegistrySource(db, env, "space_1", bearer.id, {
      baseUrl: "https://other-registry.example",
    }),
  ).rejects.toThrow("requires entering the credential again");
  await expect(
    createMcpRegistrySource(db, env, "space_1", {
      name: "Unsafe Header",
      baseUrl: "https://unsafe-registry.example",
      authType: "header",
      authHeaderName: "Cookie",
      authSecret: "secret",
    }),
  ).rejects.toThrow("safe HTTP header name");
});

test("Registry package metadata becomes a deployable candidate without direct execution", async () => {
  const db = await freshDb();
  const env = envWithEgress(async (input) => {
    const host = new URL(String(input)).host;
    if (host !== "registry.packages.example") return registryResponse([]);
    return registryResponse([
      {
        server: {
          name: "io.example/package-connector",
          title: "Package Connector",
          description: "Package metadata only",
          version: "1.2.3",
          repository: {
            url: "https://github.com/example/package-connector",
            subfolder: "deploy/opentofu",
          },
          packages: [
            {
              registryType: "npm",
              identifier: "@example/package-connector",
              version: "1.2.3",
              fileSha256: "a".repeat(64),
              runtimeHint: "node",
              transport: { type: "stdio" },
              environmentVariables: [
                { name: "EXAMPLE_TOKEN", isRequired: true, isSecret: true },
              ],
            },
          ],
        },
      },
    ]);
  });
  await createMcpRegistrySource(db, env, "space_1", {
    name: "Package Registry",
    baseUrl: "https://registry.packages.example",
  });

  const result = await searchMcpRegistrySources(db, env, {
    spaceId: "space_1",
    query: "package-connector",
  });
  expect(result.candidates).toHaveLength(1);
  expect(result.candidates[0]).toMatchObject({
    transport: "package",
    url: null,
    repositoryUrl: "https://github.com/example/package-connector",
    repositorySubfolder: "deploy/opentofu",
    requiresConfiguration: true,
    packages: [
      {
        registryType: "npm",
        identifier: "@example/package-connector",
        version: "1.2.3",
        transportType: "stdio",
        runtimeHint: "node",
      },
    ],
  });
});
