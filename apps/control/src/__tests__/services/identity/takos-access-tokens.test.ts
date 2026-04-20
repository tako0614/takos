import type { D1Database } from "@cloudflare/workers-types";

import { assert, assertEquals, assertNotEquals } from "jsr:@std/assert";
import { takosAccessTokenDeps } from "@/application/services/identity/takos-access-tokens.ts";

function createMockDrizzleDb() {
  const state: Record<string, any> = {
    get: (async (..._args: any[]) => undefined) as any,
    run: ((..._args: any[]) => undefined) as any,
  };
  const chain = {
    from: function (this: any) {
      return this;
    },
    where: function (this: any) {
      return this;
    },
    set: function (this: any) {
      return this;
    },
    get: (...args: any[]) => state.get(...args),
    run: (...args: any[]) => state.run(...args),
  };
  return {
    select: () => chain,
    update: () => chain,
    _: Object.assign(state, { chain }),
  };
}

const db = createMockDrizzleDb();

const mocks = {
  getDb: ((..._args: any[]) => undefined) as any,
};

// [Deno] vi.mock removed - manually stub imports from '@/db'
import {
  issueTakosAccessToken,
  validateTakosAccessToken,
  validateTakosPersonalAccessToken,
} from "@/services/identity/takos-access-tokens";

Deno.test("issueTakosAccessToken - generates a token with tak_pat_ prefix", async () => {
  const { token, tokenHash, tokenPrefix } = await issueTakosAccessToken();

  assert(/^tak_pat_/.test(token));
  assert(/^[a-f0-9]{64}$/.test(tokenHash));
  assertEquals(tokenPrefix, token.slice(0, 12));
  assertEquals(tokenPrefix.length, 12);
});
Deno.test("issueTakosAccessToken - produces unique tokens on successive calls", async () => {
  const a = await issueTakosAccessToken();
  const b = await issueTakosAccessToken();
  assertNotEquals(a.token, b.token);
  assertNotEquals(a.tokenHash, b.tokenHash);
});

Deno.test("validateTakosAccessToken - returns managed_takos validation when managed token matches", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mocks.getDb = (() => db) as any;
  takosAccessTokenDeps.getDb = (() => db) as any;
  // First call: managed token lookup
  db._.get = (async () => ({
    id: "tok-1",
    subjectAccountId: "user-1",
    scopesJson: '["spaces:read", "files:read"]',
  })) as any;

  const result = await validateTakosAccessToken({} as D1Database, "some-token");

  assertEquals(result, {
    userId: "user-1",
    scopes: ["spaces:read", "files:read"],
    tokenKind: "managed_takos",
  });
});
Deno.test("validateTakosAccessToken - falls through to personal token validation when managed returns null", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mocks.getDb = (() => db) as any;
  takosAccessTokenDeps.getDb = (() => db) as any;
  let callIndex = 0;
  db._.get = (async () => {
    callIndex += 1;
    if (callIndex === 1) return null;
    return {
      id: "pat-1",
      accountId: "user-2",
      scopes: '["openid"]',
      expiresAt: new Date(Date.now() + 3600_000).toISOString(),
    };
  }) as any;

  const result = await validateTakosAccessToken({} as D1Database, "some-token");

  assertEquals(result, {
    userId: "user-2",
    scopes: ["openid"],
    tokenKind: "personal",
  });
});
Deno.test("validateTakosAccessToken - returns null when neither managed nor personal token matches", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mocks.getDb = (() => db) as any;
  takosAccessTokenDeps.getDb = (() => db) as any;
  db._.get = (async () => null) as any;

  const result = await validateTakosAccessToken(
    {} as D1Database,
    "nonexistent",
  );
  assertEquals(result, null);
});
Deno.test("validateTakosAccessToken - returns null when managed token has missing required scopes", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mocks.getDb = (() => db) as any;
  takosAccessTokenDeps.getDb = (() => db) as any;
  let callIndex = 0;
  db._.get = (async () => {
    callIndex += 1;
    if (callIndex === 1) {
      return {
        id: "tok-1",
        subjectAccountId: "user-1",
        scopesJson: '["spaces:read"]',
      };
    }
    return null;
  }) as any;

  const result = await validateTakosAccessToken(
    {} as D1Database,
    "some-token",
    ["spaces:write"],
  );
  assertEquals(result, null);
});
Deno.test("validateTakosAccessToken - returns null when personal token is expired", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mocks.getDb = (() => db) as any;
  takosAccessTokenDeps.getDb = (() => db) as any;
  let callIndex = 0;
  db._.get = (async () => {
    callIndex += 1;
    if (callIndex === 1) return null;
    return {
      id: "pat-1",
      accountId: "user-1",
      scopes: '["openid"]',
      expiresAt: new Date(Date.now() - 3600_000).toISOString(),
    };
  }) as any;

  const result = await validateTakosAccessToken({} as D1Database, "some-token");
  assertEquals(result, null);
});
Deno.test('validateTakosAccessToken - returns all scopes when scopesJson is "*"', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mocks.getDb = (() => db) as any;
  takosAccessTokenDeps.getDb = (() => db) as any;
  db._.get = (async () => ({
    id: "tok-1",
    subjectAccountId: "user-1",
    scopesJson: "*",
  })) as any;

  const result = await validateTakosAccessToken({} as D1Database, "some-token");
  assertNotEquals(result, null);
  assertEquals(result!.tokenKind, "managed_takos");
  assert(result!.scopes.length > 0);
  assert(result!.scopes.includes("openid"));
  assert(result!.scopes.includes("spaces:read"));
});
Deno.test("validateTakosAccessToken - returns null when scopesJson is invalid JSON", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mocks.getDb = (() => db) as any;
  takosAccessTokenDeps.getDb = (() => db) as any;
  let callIndex = 0;
  db._.get = (async () => {
    callIndex += 1;
    if (callIndex === 1) {
      return {
        id: "tok-1",
        subjectAccountId: "user-1",
        scopesJson: "not-json",
      };
    }
    return null;
  }) as any;

  const result = await validateTakosAccessToken({} as D1Database, "some-token");
  assertEquals(result, null);
});

Deno.test("validateTakosPersonalAccessToken - validates only personal tokens (not managed)", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mocks.getDb = (() => db) as any;
  takosAccessTokenDeps.getDb = (() => db) as any;
  db._.get = (async () => ({
    id: "pat-1",
    accountId: "user-1",
    scopes: '["openid"]',
    expiresAt: null, // no expiry
  })) as any;

  const result = await validateTakosPersonalAccessToken(
    {} as D1Database,
    "some-token",
  );

  assertEquals(result, {
    userId: "user-1",
    scopes: ["openid"],
    tokenKind: "personal",
  });
});
Deno.test("validateTakosPersonalAccessToken - returns null when personal token not found", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mocks.getDb = (() => db) as any;
  takosAccessTokenDeps.getDb = (() => db) as any;
  db._.get = (async () => null) as any;

  const result = await validateTakosPersonalAccessToken(
    {} as D1Database,
    "nonexistent",
  );
  assertEquals(result, null);
});
