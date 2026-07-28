import { test } from "bun:test";
import { assertEquals } from "@takos/test/assert";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import * as schema from "../../../../infra/db/schema.ts";
import type { Env } from "../../../../shared/types/index.ts";
import type { SqlDatabaseBinding } from "../../../../shared/types/bindings.ts";
import { resolveSelfIssuedBearer } from "../in-process-bearer.ts";

const ISSUER = "https://issuer.example.test";

test("resolveSelfIssuedBearer validates an opaque token through Accounts UserInfo", async () => {
  let receivedRequest: Request | undefined;
  const result = await resolveSelfIssuedBearer({
    authorizationHeader: "Bearer opaque-with-no-prefix-or-jwt-shape",
    issuer: ISSUER,
    db: dbWithIdentity(),
    env: {
      TAKOSUMI_ACCOUNTS_INTERNAL_URL: "http://accounts.internal/",
      OIDC_MOBILE_CLIENT_ID: "takos-mobile",
    } as Env,
    fetchImpl: async (request) => {
      receivedRequest = request instanceof Request
        ? request
        : new Request(request);
      return Response.json({
        sub: "tsub_1",
        aud: "takos-mobile",
        scope: "profile spaces:read",
        takosumi: { workspace_id: "workspace_1" },
        workspace_memberships: ["workspace_1"],
      });
    },
  });

  assertEquals(result.kind, "ok");
  if (result.kind === "ok") {
    assertEquals(result.subject, "tsub_1");
    assertEquals(result.scopes, ["profile", "spaces:read"]);
    assertEquals(result.workspaceId, "workspace_1");
  }
  assertEquals(
    receivedRequest?.url,
    "http://accounts.internal/oauth/userinfo",
  );
  assertEquals(
    receivedRequest?.headers.get("authorization"),
    "Bearer opaque-with-no-prefix-or-jwt-shape",
  );
});

test("resolveSelfIssuedBearer rejects inconsistent trusted Workspace evidence", async () => {
  const result = await resolveSelfIssuedBearer({
    authorizationHeader: "Bearer mismatched-workspace-token",
    issuer: ISSUER,
    db: dbWithIdentity(),
    env: { OIDC_MOBILE_CLIENT_ID: "takos-mobile" } as Env,
    fetchImpl: async () =>
      Response.json({
        sub: "tsub_1",
        aud: "takos-mobile",
        scope: "profile",
        takosumi: { workspace_id: "workspace_a" },
        workspace_memberships: ["workspace_b"],
      }),
  });

  assertEquals(result.kind, "invalid");
});

test("resolveSelfIssuedBearer rejects ordinary OAuth for another audience", async () => {
  const result = await resolveSelfIssuedBearer({
    authorizationHeader: "Bearer wrong-audience-token",
    issuer: ISSUER,
    db: dbWithIdentity(),
    env: { OIDC_MOBILE_CLIENT_ID: "takos-mobile" } as Env,
    fetchImpl: async () =>
      Response.json({
        sub: "tsub_1",
        aud: "another-mobile-client",
        scope: "profile",
      }),
  });

  assertEquals(result.kind, "invalid");
});

test("resolveSelfIssuedBearer rejects a token rejected by Accounts UserInfo", async () => {
  const result = await resolveSelfIssuedBearer({
    authorizationHeader: "Bearer arbitrary-opaque-input",
    issuer: ISSUER,
    db: dbWithIdentity(),
    env: {} as Env,
    fetchImpl: async () =>
      Response.json(
        { error: "invalid_token" },
        { status: 401 },
      ),
  });

  assertEquals(result.kind, "invalid");
});

test("resolveSelfIssuedBearer rejects an OIDC id_token that UserInfo does not recognize", async () => {
  const jwtShapedIdToken = "header.payload.signature";
  const result = await resolveSelfIssuedBearer({
    authorizationHeader: `Bearer ${jwtShapedIdToken}`,
    issuer: ISSUER,
    db: dbWithIdentity(),
    env: {} as Env,
    fetchImpl: async (request) => {
      const forwarded = request instanceof Request
        ? request
        : new Request(request);
      assertEquals(
        forwarded.headers.get("authorization"),
        `Bearer ${jwtShapedIdToken}`,
      );
      return Response.json({ error: "invalid_token" }, { status: 401 });
    },
  });

  assertEquals(result.kind, "invalid");
});

test("concurrent first bearer requests provision one issuer-sub identity", async () => {
  const fixture = await createProvisioningDb();
  try {
    const resolve = () =>
      resolveSelfIssuedBearer({
        authorizationHeader: "Bearer first-mobile-access-token",
        issuer: ISSUER,
        db: fixture.db,
        env: { OIDC_MOBILE_CLIENT_ID: "takos-mobile" } as Env,
        fetchImpl: async () =>
          Response.json({
            sub: "tsub_first",
            aud: "takos-mobile",
            scope: "openid profile email spaces:read",
            email: "first@example.test",
            email_verified: true,
            name: "First Mobile User",
            picture: "https://accounts.example.test/first.png",
          }),
      });

    const [first, concurrent] = await Promise.all([resolve(), resolve()]);
    assertEquals(first.kind, "ok");
    assertEquals(concurrent.kind, "ok");
    if (first.kind === "ok" && concurrent.kind === "ok") {
      assertEquals(first.userId, concurrent.userId);
      assertEquals(first.user.email, "first@example.test");
    }

    const identities = await fixture.client.execute(
      "SELECT provider_sub, email_snapshot, email_kind FROM auth_identities",
    );
    assertEquals(identities.rows.length, 1);
    assertEquals(
      identities.rows[0].provider_sub,
      `${ISSUER}#tsub_first`,
    );
    assertEquals(identities.rows[0].email_snapshot, "first@example.test");
    assertEquals(identities.rows[0].email_kind, "oidc_verified");

    const accounts = await fixture.client.execute(
      "SELECT email, name FROM accounts",
    );
    assertEquals(accounts.rows.length, 1);
    assertEquals(accounts.rows[0].email, "first@example.test");
    assertEquals(accounts.rows[0].name, "First Mobile User");
  } finally {
    fixture.client.close();
  }
});

test("first bearer provisioning never trusts an unverified UserInfo email", async () => {
  const fixture = await createProvisioningDb();
  try {
    const result = await resolveSelfIssuedBearer({
      authorizationHeader: "Bearer first-unverified-access-token",
      issuer: ISSUER,
      db: fixture.db,
      env: { OIDC_MOBILE_CLIENT_ID: "takos-mobile" } as Env,
      fetchImpl: async () =>
        Response.json({
          sub: "tsub_unverified",
          aud: "takos-mobile",
          scope: "openid profile email",
          email: "unverified@example.test",
          email_verified: false,
          name: "Unverified User",
        }),
    });

    assertEquals(result.kind, "ok");
    const accounts = await fixture.client.execute("SELECT email FROM accounts");
    assertEquals(accounts.rows[0].email, null);
    const identities = await fixture.client.execute(
      "SELECT email_snapshot, email_kind FROM auth_identities",
    );
    assertEquals(
      identities.rows[0].email_snapshot,
      "unverified@example.test",
    );
    assertEquals(identities.rows[0].email_kind, "unknown");
  } finally {
    fixture.client.close();
  }
});

async function createProvisioningDb() {
  const client = createClient({ url: ":memory:" });
  await client.executeMultiple(`
    CREATE TABLE accounts (
      id TEXT NOT NULL PRIMARY KEY,
      type TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      name TEXT NOT NULL,
      slug TEXT NOT NULL UNIQUE,
      description TEXT,
      picture TEXT,
      bio TEXT,
      email TEXT UNIQUE,
      trust_tier TEXT NOT NULL DEFAULT 'new',
      setup_completed INTEGER NOT NULL DEFAULT 0,
      default_repository_id TEXT,
      head_snapshot_id TEXT,
      ai_model TEXT DEFAULT 'gpt-5.5',
      model_backend TEXT DEFAULT 'openai',
      security_posture TEXT NOT NULL DEFAULT 'standard',
      owner_account_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE auth_identities (
      id TEXT NOT NULL PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES accounts(id),
      provider TEXT NOT NULL,
      provider_sub TEXT NOT NULL,
      email_snapshot TEXT,
      email_kind TEXT NOT NULL DEFAULT 'unknown',
      linked_at TEXT NOT NULL,
      last_login_at TEXT NOT NULL,
      refresh_token_enc TEXT,
      access_token_enc TEXT,
      access_token_expires_at TEXT,
      token_scope TEXT,
      delegated_workspace_id TEXT,
      refresh_lease_id TEXT,
      refresh_lease_expires_at TEXT
    );
    CREATE UNIQUE INDEX idx_auth_identities_provider_sub
      ON auth_identities(provider, provider_sub);
  `);
  return {
    client,
    db: drizzle(client, { schema }) as unknown as SqlDatabaseBinding,
  };
}

// resolveSelfIssuedUser: select(authIdentities).get() -> {userId}, then
// select(accounts).get() -> active account row.
function dbWithIdentity(): SqlDatabaseBinding {
  let getCall = 0;
  const db = {
    select() {
      return {
        from() {
          return {
            where() {
              return {
                get: async () => {
                  getCall++;
                  if (getCall === 1) return { userId: "user_1" };
                  return {
                    id: "user_1",
                    status: "active",
                    email: "u@example.test",
                    name: "U",
                    slug: "u",
                    bio: null,
                    picture: null,
                    trustTier: "standard",
                    setupCompleted: true,
                    createdAt: "2026-01-01T00:00:00.000Z",
                    updatedAt: "2026-01-01T00:00:00.000Z",
                  };
                },
                all: async () => [],
              };
            },
          };
        },
      };
    },
    insert() {
      return { values: () => ({ run: async () => ({}) }) };
    },
    update() {
      return { set: () => ({ where: async () => ({}) }) };
    },
    delete() {
      return { where: async () => ({}) };
    },
    prepare() {
      return {};
    },
  };
  return db as unknown as SqlDatabaseBinding;
}
