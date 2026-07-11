import { expect, test } from "bun:test";
import { SQLiteSyncDialect } from "drizzle-orm/sqlite-core";

import { mcpServers } from "../../../../infra/db/index.ts";
import type { Env } from "../../../../shared/types/index.ts";
import type { SqlDatabaseBinding } from "../../../../shared/types/bindings.ts";
import { decryptToken, saltFor } from "../mcp/crypto.ts";
import { completeMcpOAuthFlow } from "../mcp/oauth.ts";

type McpRow = {
  id: string;
  accountId: string;
  name: string;
  url: string;
  sourceType: string;
  authMode: string;
  oauthAccessToken: string | null;
  oauthRefreshToken: string | null;
  oauthTokenExpiresAt: string | null;
  oauthScope: string | null;
  oauthIssuerUrl: string | null;
  oauthResourceUri: string | null;
  oauthResourceMetadataUrl: string | null;
  oauthClientId: string | null;
  oauthClientSecret: string | null;
  oauthClientIdIssuedAt: number | null;
  oauthClientSecretExpiresAt: number | null;
  oauthRegistrationMode: string | null;
  oauthTokenEndpointAuthMethod: string | null;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
};

const dialect = new SQLiteSyncDialect();
const columnToRowKey: Record<string, keyof McpRow> = {
  id: "id",
  account_id: "accountId",
  name: "name",
  url: "url",
  source_type: "sourceType",
};

function row(overrides: Partial<McpRow> = {}): McpRow {
  return {
    id: "srv_existing",
    accountId: "space_1",
    name: "docs",
    url: "https://connector.example/mcp",
    sourceType: "external",
    authMode: "oauth_pkce",
    oauthAccessToken: null,
    oauthRefreshToken: null,
    oauthTokenExpiresAt: null,
    oauthScope: null,
    oauthIssuerUrl: null,
    oauthResourceUri: null,
    oauthResourceMetadataUrl: null,
    oauthClientId: null,
    oauthClientSecret: null,
    oauthClientIdIssuedAt: null,
    oauthClientSecretExpiresAt: null,
    oauthRegistrationMode: null,
    oauthTokenEndpointAuthMethod: null,
    enabled: true,
    createdAt: "2026-07-11T00:00:00.000Z",
    updatedAt: "2026-07-11T00:00:00.000Z",
    ...overrides,
  };
}

function matches(rowValue: McpRow, condition: unknown): boolean {
  const query = dialect.sqlToQuery(condition as never);
  const columns = Array.from(
    query.sql.matchAll(/"mcp_servers"\."([^"]+)" = \?/g),
    (match) => match[1],
  );
  if (columns.length !== query.params.length) {
    throw new Error(`Unsupported test condition: ${query.sql}`);
  }
  return columns.every((column, index) => {
    const key = columnToRowKey[column];
    if (!key) throw new Error(`Unsupported test column: ${column}`);
    return rowValue[key] === query.params[index];
  });
}

function endpointDb(
  rows: McpRow[],
  options: { beforeInsert?: () => void; beforeUpdate?: () => void } = {},
) {
  let beforeInsert = options.beforeInsert;
  let beforeUpdate = options.beforeUpdate;
  const db = {
    select: () => ({
      from: (table: unknown) => {
        if (table !== mcpServers) throw new Error("Unexpected table");
        return {
          where: (condition: unknown) => ({
            get: async () =>
              rows.find((item) => matches(item, condition)) ?? null,
          }),
        };
      },
    }),
    insert: (table: unknown) => {
      if (table !== mcpServers) throw new Error("Unexpected table");
      return {
        values: async (value: McpRow) => {
          if (beforeInsert) {
            const hook = beforeInsert;
            beforeInsert = undefined;
            hook();
          }
          if (
            rows.some(
              (item) =>
                item.accountId === value.accountId && item.name === value.name,
            )
          ) {
            throw new Error(
              "UNIQUE constraint failed: mcp_servers.account_id, mcp_servers.name",
            );
          }
          rows.push({ ...value });
          return { meta: { changes: 1 } };
        },
      };
    },
    update: (table: unknown) => {
      if (table !== mcpServers) throw new Error("Unexpected table");
      return {
        set: (patch: Partial<McpRow>) => ({
          where: async (condition: unknown) => {
            if (beforeUpdate) {
              const hook = beforeUpdate;
              beforeUpdate = undefined;
              hook();
            }
            let changes = 0;
            for (const item of rows) {
              if (!matches(item, condition)) continue;
              Object.assign(item, patch);
              changes += 1;
            }
            return { meta: { changes } };
          },
        }),
      };
    },
    delete: () => ({ where: async () => ({ meta: { changes: 0 } }) }),
  };
  return db as unknown as SqlDatabaseBinding;
}

function oauthEnv(db: SqlDatabaseBinding, expiresIn = 3600) {
  let tokenRequests = 0;
  const tokenRequestBodies: URLSearchParams[] = [];
  const env = {
    DB: db,
    ENVIRONMENT: "production",
    ENCRYPTION_KEY: "mcp-endpoint-binding-test-key",
    TAKOS_EGRESS: {
      fetch: async (_input: RequestInfo | URL, init?: RequestInit) => {
        tokenRequests += 1;
        tokenRequestBodies.push(new URLSearchParams(String(init?.body ?? "")));
        return Response.json({
          access_token: "access-for-connector",
          refresh_token: "refresh-for-connector",
          token_type: "Bearer",
          expires_in: expiresIn,
          scope: "docs.read docs.write",
        });
      },
    },
  } as unknown as Env;
  return { env, tokenRequests: () => tokenRequests, tokenRequestBodies };
}

function completionParams(serverUrl = "https://connector.example/mcp") {
  return {
    spaceId: "space_1",
    serverName: "docs",
    serverUrl,
    authorizationEndpoint: "https://auth.connector.example/authorize",
    tokenEndpoint: "https://auth.connector.example/token",
    resourceUri: serverUrl,
    resourceMetadataUrl:
      "https://connector.example/.well-known/oauth-protected-resource/mcp",
    clientId: "https://takos.example/api/mcp/client.json",
    clientSecret: "registered-client-secret",
    clientIdIssuedAt: 1_788_825_600,
    clientSecretExpiresAt: 0,
    registrationMode: "dynamic" as const,
    tokenEndpointAuthMethod: "client_secret_basic" as const,
    code: "authorization-code",
    codeVerifier: "pkce-verifier",
    redirectUri: "https://takos.example/api/mcp/oauth/callback",
    scope: "docs.read docs.write",
    issuerUrl: "https://auth.connector.example",
  };
}

async function decryptedAccessToken(env: Env, item: McpRow): Promise<string> {
  return await decryptToken(
    item.oauthAccessToken!,
    env.ENCRYPTION_KEY!,
    saltFor(item.id, "access"),
  );
}

async function decryptedClientSecret(env: Env, item: McpRow): Promise<string> {
  return await decryptToken(
    item.oauthClientSecret!,
    env.ENCRYPTION_KEY!,
    saltFor(item.id, "client-secret"),
  );
}

test("OAuth callback inserts an initial server bound to the authorized endpoint", async () => {
  const rows: McpRow[] = [];
  const db = endpointDb(rows);
  const { env, tokenRequestBodies } = oauthEnv(db);

  const result = await completeMcpOAuthFlow(db, env, completionParams());

  expect(rows).toHaveLength(1);
  expect(rows[0].id).toBe(result.serverId);
  expect(rows[0].url).toBe("https://connector.example/mcp");
  expect(await decryptedAccessToken(env, rows[0])).toBe("access-for-connector");
  expect(await decryptedClientSecret(env, rows[0])).toBe(
    "registered-client-secret",
  );
  expect(tokenRequestBodies[0].get("resource")).toBe(
    "https://connector.example/mcp",
  );
});

test("OAuth callback preserves an explicit zero-second token expiry", async () => {
  const rows: McpRow[] = [];
  const db = endpointDb(rows);
  const { env } = oauthEnv(db, 0);
  const now = 1_788_825_600_000;

  await completeMcpOAuthFlow(db, env, completionParams(), { now: () => now });

  expect(rows[0].oauthTokenExpiresAt).toBe(new Date(now).toISOString());
});

test("OAuth callback rejects a pre-existing same-name different endpoint before token exchange", async () => {
  const existing = row({ url: "https://connector-a.example/mcp" });
  const rows = [existing];
  const db = endpointDb(rows);
  const { env, tokenRequests } = oauthEnv(db);

  await expect(
    completeMcpOAuthFlow(
      db,
      env,
      completionParams("https://connector-b.example/mcp"),
    ),
  ).rejects.toThrow("already bound to a different endpoint");

  expect(tokenRequests()).toBe(0);
  expect(existing.oauthAccessToken).toBeNull();
  expect(existing.oauthIssuerUrl).toBeNull();
});

test("OAuth callback adopts a same-endpoint insert race using the winning row encryption salt", async () => {
  const rows: McpRow[] = [];
  const raced = row({ id: "srv_race_winner" });
  const db = endpointDb(rows, {
    beforeInsert: () => rows.push(raced),
  });
  const { env } = oauthEnv(db);

  const result = await completeMcpOAuthFlow(db, env, completionParams());

  expect(result.serverId).toBe("srv_race_winner");
  expect(rows).toHaveLength(1);
  expect(await decryptedAccessToken(env, raced)).toBe("access-for-connector");
});

test("OAuth callback conditional update fails if the endpoint changes after preflight", async () => {
  const existing = row();
  const rows = [existing];
  const db = endpointDb(rows, {
    beforeUpdate: () => {
      existing.url = "https://replacement.example/mcp";
    },
  });
  const { env } = oauthEnv(db);

  await expect(
    completeMcpOAuthFlow(db, env, completionParams()),
  ).rejects.toThrow("already bound to a different endpoint");

  expect(existing.url).toBe("https://replacement.example/mcp");
  expect(existing.oauthAccessToken).toBeNull();
  expect(existing.oauthRefreshToken).toBeNull();
  expect(existing.oauthIssuerUrl).toBeNull();
});

test("OAuth callback never attaches tokens after a different-endpoint collision race", async () => {
  const rows: McpRow[] = [];
  const collision = row({
    id: "srv_other_endpoint",
    url: "https://other.example/mcp",
  });
  const db = endpointDb(rows, {
    beforeInsert: () => rows.push(collision),
  });
  const { env } = oauthEnv(db);

  await expect(
    completeMcpOAuthFlow(db, env, completionParams()),
  ).rejects.toThrow("already bound to a different endpoint");

  expect(rows).toEqual([collision]);
  expect(collision.oauthAccessToken).toBeNull();
  expect(collision.oauthRefreshToken).toBeNull();
  expect(collision.oauthIssuerUrl).toBeNull();
});
