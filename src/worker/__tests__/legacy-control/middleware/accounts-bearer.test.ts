import { assertEquals } from "@std/assert";

import {
  accountsBearerDeps,
  validateTakosumiAccountsBearer,
} from "../../../server/middleware/accounts-bearer.ts";
import { asTestDatabase } from "@test/db-stubs";

const originalDeps = { ...accountsBearerDeps };

function restoreDeps() {
  Object.assign(accountsBearerDeps, originalDeps);
}

function createFakeDb() {
  const inserts: unknown[] = [];
  const selectChain = {
    from: function (this: unknown) {
      return this;
    },
    where: function (this: unknown) {
      return this;
    },
    get: async () => undefined,
  };
  return {
    db: {
      select: () => selectChain,
      insert: () => ({
        values: (value: unknown) => {
          inserts.push(value);
        },
      }),
    },
    inserts,
  };
}

Deno.test("validateTakosumiAccountsBearer introspects Accounts PAT and provisions app-local profile", async () => {
  const requested: Array<{ url: string; init?: RequestInit }> = [];
  const { db, inserts } = createFakeDb();
  const wrappedDb = asTestDatabase(db);
  accountsBearerDeps.getDb =
    ((..._args: Parameters<typeof accountsBearerDeps.getDb>) =>
      wrappedDb) as typeof accountsBearerDeps.getDb;
  accountsBearerDeps.provisionOidcUser = (async () => ({
    id: "acct_local",
    email: "owner@example.test",
    name: "Owner",
    username: "owner",
    bio: null,
    picture: null,
    setup_completed: false,
    created_at: "2026-05-09T00:00:00.000Z",
    updated_at: "2026-05-09T00:00:00.000Z",
  })) as typeof accountsBearerDeps.provisionOidcUser;
  accountsBearerDeps.randomUUID = () => "00000000-0000-4000-8000-000000000001";
  accountsBearerDeps.fetch = (async (input, init) => {
    const url = input.toString();
    requested.push({ url, init });
    if (url.endsWith("/.well-known/openid-configuration")) {
      return Response.json({
        issuer: "https://accounts.example.test",
        introspection_endpoint:
          "https://accounts.example.test/oauth/introspect",
      });
    }
    if (url.endsWith("/oauth/introspect")) {
      const body = init?.body as URLSearchParams;
      assertEquals(body.get("token"), "takpat_valid");
      assertEquals(body.get("client_id"), "takos-worker");
      assertEquals(body.get("client_secret"), "secret");
      return Response.json({
        active: true,
        iss: "https://accounts.example.test",
        sub: "acct_subject",
        scope: "openid profile threads:read",
        email: "owner@example.test",
        email_verified: true,
        name: "Owner",
      });
    }
    return new Response(null, { status: 404 });
  }) as typeof accountsBearerDeps.fetch;

  try {
    const result = await validateTakosumiAccountsBearer({
      db: {} as never,
      token: "takpat_valid",
      issuerUrl: "https://accounts.example.test",
      clientId: "takos-worker",
      clientSecret: "secret",
      requiredScopes: ["threads:read"],
    });

    assertEquals(result?.userId, "acct_local");
    assertEquals(result?.tokenKind, "takosumi_accounts");
    assertEquals(result?.subject, "acct_subject");
    assertEquals(result?.scopes.includes("threads:read"), true);
    assertEquals(inserts.length, 1);
    assertEquals(requested.length, 2);
  } finally {
    restoreDeps();
  }
});

Deno.test("validateTakosumiAccountsBearer rejects inactive introspection responses", async () => {
  accountsBearerDeps.fetch = (async (input) => {
    const url = input.toString();
    if (url.endsWith("/.well-known/openid-configuration")) {
      return Response.json({
        issuer: "https://accounts.example.test",
        introspection_endpoint:
          "https://accounts.example.test/oauth/introspect",
      });
    }
    return Response.json({ active: false });
  }) as typeof accountsBearerDeps.fetch;

  try {
    const result = await validateTakosumiAccountsBearer({
      db: {} as never,
      token: "takpat_invalid",
      issuerUrl: "https://accounts.example.test",
    });
    assertEquals(result, null);
  } finally {
    restoreDeps();
  }
});
