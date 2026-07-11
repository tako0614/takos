import { expect, test } from "bun:test";
import { createClient, type Client } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";

import * as schema from "../../../../infra/db/schema.ts";
import type { Database } from "../../../../infra/db/client.ts";
import type { SqlDatabaseBinding } from "../../../../shared/types/bindings.ts";
import type { Env } from "../../../../shared/types/index.ts";
import {
  exportMcpConnections,
  importMcpConnections,
  mcpConnectionsExportSchema,
} from "../mcp/portable-connections.ts";

async function freshDb(): Promise<{ client: Client; db: Database }> {
  const client = createClient({ url: ":memory:" });
  await client.executeMultiple(`
    CREATE TABLE mcp_servers (
      id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL,
      name TEXT NOT NULL,
      url TEXT NOT NULL,
      transport TEXT NOT NULL DEFAULT 'streamable-http',
      source_type TEXT NOT NULL DEFAULT 'external',
      auth_mode TEXT NOT NULL DEFAULT 'oauth_pkce',
      service_id TEXT,
      bundle_deployment_id TEXT,
      oauth_access_token TEXT,
      oauth_refresh_token TEXT,
      oauth_token_expires_at TEXT,
      oauth_scope TEXT,
      oauth_issuer_url TEXT,
      oauth_resource_uri TEXT,
      oauth_resource_metadata_url TEXT,
      oauth_client_id TEXT,
      oauth_client_secret TEXT,
      oauth_client_id_issued_at INTEGER,
      oauth_client_secret_expires_at INTEGER,
      oauth_registration_mode TEXT,
      oauth_token_endpoint_auth_method TEXT,
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE UNIQUE INDEX idx_mcp_servers_account_name
      ON mcp_servers(account_id, name);
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
    CREATE TABLE mcp_tool_policies (
      account_id TEXT NOT NULL,
      server_id TEXT NOT NULL,
      tool_name TEXT NOT NULL,
      schema_hash TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 0,
      invocation_policy TEXT NOT NULL DEFAULT 'confirm_each_time',
      first_seen_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL,
      reviewed_at TEXT
    );
    CREATE UNIQUE INDEX idx_mcp_tool_policies_account_server_tool
      ON mcp_tool_policies(account_id, server_id, tool_name);
  `);
  return {
    client,
    db: drizzle(client, { schema }) as unknown as Database,
  };
}

test("portable Connections export contains endpoints and policy intent but no credentials", async () => {
  const { client, db } = await freshDb();
  try {
    const now = "2026-07-11T00:00:00.000Z";
    await client.execute({
      sql: `INSERT INTO mcp_servers (
        id, account_id, name, url, source_type, auth_mode,
        oauth_access_token, oauth_refresh_token, oauth_client_id,
        oauth_client_secret, oauth_scope, enabled, created_at, updated_at
      ) VALUES (?, ?, ?, ?, 'external', 'oauth_pkce', ?, ?, ?, ?, ?, 1, ?, ?)`,
      args: [
        "server_1",
        "workspace_1",
        "docs",
        "https://connector.example/mcp",
        "secret-access-token",
        "secret-refresh-token",
        "secret-client-id",
        "secret-client-secret",
        "docs.read",
        now,
        now,
      ],
    });
    await client.execute({
      sql: `INSERT INTO mcp_registry_sources (
        id, account_id, name, base_url, source_kind, auth_type,
        auth_secret, enabled, priority, created_at, updated_at
      ) VALUES (?, ?, ?, ?, 'organization', 'bearer', ?, 1, 20, ?, ?)`,
      args: [
        "registry_1",
        "workspace_1",
        "Company Registry",
        "https://registry.example",
        "secret-registry-ciphertext",
        now,
        now,
      ],
    });
    await client.execute({
      sql: `INSERT INTO mcp_tool_policies (
        account_id, server_id, tool_name, schema_hash, enabled,
        invocation_policy, first_seen_at, last_seen_at, reviewed_at
      ) VALUES (?, ?, ?, ?, 1, 'confirm_each_time', ?, ?, ?)`,
      args: [
        "workspace_1",
        "server_1",
        "docs.read",
        "a".repeat(64),
        now,
        now,
        now,
      ],
    });

    const exported = await exportMcpConnections(db, "workspace_1");
    expect(mcpConnectionsExportSchema.safeParse(exported).success).toBe(true);
    expect(exported.connections).toMatchObject([
      {
        name: "docs",
        url: "https://connector.example/mcp",
        scope: "docs.read",
        tools: [
          {
            name: "docs.read",
            enabled: true,
            invocation_policy: "confirm_each_time",
          },
        ],
      },
    ]);
    const serialized = JSON.stringify(exported);
    for (const secret of [
      "secret-access-token",
      "secret-refresh-token",
      "secret-client-id",
      "secret-client-secret",
      "secret-registry-ciphertext",
    ]) {
      expect(serialized).not.toContain(secret);
    }
  } finally {
    client.close();
  }
});

test("portable import keeps credential-bearing Registry sources disabled until re-entry", async () => {
  const { client, db } = await freshDb();
  try {
    const result = await importMcpConnections(
      db as unknown as SqlDatabaseBinding,
      {
        ENVIRONMENT: "production",
        ENCRYPTION_KEY: "portable-import-test-encryption-key",
      } as Env,
      {
        accountId: "workspace_2",
        userId: "user_2",
        document: {
          format: "takos.mcp.connections",
          version: 1,
          exported_at: "2026-07-11T00:00:00.000Z",
          registry_sources: [
            {
              kind: "organization",
              name: "Private Registry",
              base_url: "https://private-registry.example",
              enabled: true,
              priority: 50,
              auth_type: "bearer",
              auth_header_name: null,
              credential_required: true,
            },
          ],
          connections: [],
        },
      },
    );
    expect(result.registrySources).toEqual([
      {
        baseUrl: "https://private-registry.example",
        status: "credential_required",
      },
    ]);
    const row = await client.execute(
      "SELECT auth_type, auth_secret, enabled FROM mcp_registry_sources WHERE account_id = 'workspace_2'",
    );
    expect(row.rows).toMatchObject([
      { auth_type: "bearer", auth_secret: null, enabled: 0 },
    ]);
  } finally {
    client.close();
  }
});

test("portable format rejects extensions and inconsistent Registry auth metadata", () => {
  const base = {
    format: "takos.mcp.connections",
    version: 1,
    exported_at: "2026-07-11T00:00:00.000Z",
    registry_sources: [],
    connections: [],
  };
  expect(
    mcpConnectionsExportSchema.safeParse({ ...base, unexpected: true }).success,
  ).toBe(false);
  expect(
    mcpConnectionsExportSchema.safeParse({
      ...base,
      registry_sources: [
        {
          kind: "custom",
          name: "Broken",
          base_url: "https://registry.example",
          enabled: false,
          priority: 0,
          auth_type: "header",
          auth_header_name: null,
          credential_required: true,
        },
      ],
    }).success,
  ).toBe(false);
});
