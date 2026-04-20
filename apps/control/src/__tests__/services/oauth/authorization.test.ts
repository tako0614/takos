import type { D1Database } from "@cloudflare/workers-types";

import {
  buildErrorRedirect,
  buildSuccessRedirect,
} from "@/services/oauth/authorization";
import {
  generateCodeChallenge,
  generateCodeVerifier,
} from "@/services/oauth/pkce";
import { computeSHA256 } from "@/utils/hash";

// ---------------------------------------------------------------------------
// Pure function tests (no DB needed)
// ---------------------------------------------------------------------------

import { assert, assertEquals, assertStringIncludes } from "jsr:@std/assert";

Deno.test("buildErrorRedirect - appends error, error_description, and state to the redirect URI", () => {
  const url = buildErrorRedirect(
    "https://example.com/callback",
    "state123",
    "access_denied",
    "User denied access",
  );

  const parsed = new URL(url);
  assertEquals(parsed.origin + parsed.pathname, "https://example.com/callback");
  assertEquals(parsed.searchParams.get("error"), "access_denied");
  assertEquals(
    parsed.searchParams.get("error_description"),
    "User denied access",
  );
  assertEquals(parsed.searchParams.get("state"), "state123");
});
Deno.test("buildErrorRedirect - omits error_description when not provided", () => {
  const url = buildErrorRedirect(
    "https://example.com/callback",
    "state",
    "server_error",
  );

  const parsed = new URL(url);
  assertEquals(parsed.searchParams.has("error_description"), false);
  assertEquals(parsed.searchParams.get("error"), "server_error");
  assertEquals(parsed.searchParams.get("state"), "state");
});
Deno.test("buildErrorRedirect - preserves existing query parameters", () => {
  const url = buildErrorRedirect(
    "https://example.com/callback?foo=bar",
    "state",
    "invalid_scope",
  );

  const parsed = new URL(url);
  assertEquals(parsed.searchParams.get("foo"), "bar");
  assertEquals(parsed.searchParams.get("error"), "invalid_scope");
});

Deno.test("buildSuccessRedirect - appends code and state to the redirect URI", () => {
  const url = buildSuccessRedirect(
    "https://example.com/callback",
    "state123",
    "auth-code-abc",
  );

  const parsed = new URL(url);
  assertEquals(parsed.searchParams.get("code"), "auth-code-abc");
  assertEquals(parsed.searchParams.get("state"), "state123");
});
// ---------------------------------------------------------------------------
// DB-dependent tests (validateAuthorizationRequest, generateAuthorizationCode, exchangeAuthorizationCode)
// ---------------------------------------------------------------------------

function createMockDrizzleDb() {
  const chain: any = {
    from: function (this: any) {
      return this;
    },
    where: function (this: any) {
      return this;
    },
    set: function (this: any) {
      return this;
    },
    values: function (this: any) {
      return this;
    },
    get: (async (..._args: any[]) => undefined) as any,
    all: (async (..._args: any[]) => undefined) as any,
  };
  const control = {
    get get() {
      return chain.get;
    },
    set get(value: any) {
      chain.get = value;
    },
    get all() {
      return chain.all;
    },
    set all(value: any) {
      chain.all = value;
    },
    get chain() {
      return chain;
    },
  };
  const insert = ((..._args: any[]) => {
    insert.calls.push(_args);
    return chain;
  }) as any;
  insert.calls = [] as unknown[][];
  return {
    select: () => chain,
    insert,
    update: () => ({
      set: () => ({
        where: async () => ({ meta: { changes: 1 } }),
      }),
    }),
    delete: () => chain,
    _: control,
  };
}

function assertErrorDescriptionIncludes(
  result: { errorDescription?: string | null },
  expected: string,
) {
  assert(result.errorDescription);
  assertStringIncludes(result.errorDescription, expected);
}

const db = createMockDrizzleDb();
const d1 = db as unknown as D1Database;
(globalThis as typeof globalThis & { __takosDbMock?: unknown }).__takosDbMock = db as never;

const mocks = {
  getDb: ((..._args: any[]) => undefined) as any,
  revokeTokensByAuthorizationCode: (async (..._args: any[]) => {
    mocks.revokeTokensByAuthorizationCode.calls.push(_args);
    return 0;
  }) as any,
};
mocks.revokeTokensByAuthorizationCode.calls = [] as unknown[][];

// [Deno] vi.mock removed - manually stub imports from '@/db'
// [Deno] vi.mock removed - manually stub imports from '@/services/oauth/token'
import {
  authorizationDeps,
  exchangeAuthorizationCode,
  generateAuthorizationCode,
  validateAuthorizationRequest,
} from "@/services/oauth/authorization";

const originalAuthorizationDeps = { ...authorizationDeps };

Deno.test("validateAuthorizationRequest - rejects unsupported response_type", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mocks.getDb = (() => db) as any;
  const result = await validateAuthorizationRequest(d1, {
    response_type: "token" as never,
  });

  assertEquals(result.valid, false);
  assertEquals(result.error, "unsupported_response_type");
});
Deno.test("validateAuthorizationRequest - rejects missing client_id", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mocks.getDb = (() => db) as any;
  const result = await validateAuthorizationRequest(d1, {
    response_type: "code",
  });

  assertEquals(result.valid, false);
  assertEquals(result.error, "invalid_request");
  assertErrorDescriptionIncludes(result, "client_id");
});
Deno.test("validateAuthorizationRequest - rejects nonexistent client", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mocks.getDb = (() => db) as any;
  db._.get = (async () => null) as any; // getClientById returns null

  const result = await validateAuthorizationRequest(d1, {
    response_type: "code",
    client_id: "nonexistent",
  });

  assertEquals(result.valid, false);
  assertEquals(result.error, "invalid_client");
});
Deno.test("validateAuthorizationRequest - rejects missing redirect_uri", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mocks.getDb = (() => db) as any;
  db._.get = (async () => ({
    id: "int-1",
    clientId: "client-1",
    clientSecretHash: null,
    clientType: "public",
    name: "App",
    description: null,
    logoUri: null,
    clientUri: null,
    policyUri: null,
    tosUri: null,
    redirectUris: '["https://example.com/cb"]',
    grantTypes: '["authorization_code"]',
    responseTypes: '["code"]',
    allowedScopes: '["openid"]',
    ownerAccountId: null,
    registrationAccessTokenHash: null,
    status: "active",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  })) as any;

  const result = await validateAuthorizationRequest(d1, {
    response_type: "code",
    client_id: "client-1",
  });

  assertEquals(result.valid, false);
  assertEquals(result.error, "invalid_request");
  assertErrorDescriptionIncludes(result, "redirect_uri");
});
Deno.test("validateAuthorizationRequest - rejects unregistered redirect_uri", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mocks.getDb = (() => db) as any;
  db._.get = (async () => ({
    id: "int-1",
    clientId: "client-1",
    clientSecretHash: null,
    clientType: "public",
    name: "App",
    description: null,
    logoUri: null,
    clientUri: null,
    policyUri: null,
    tosUri: null,
    redirectUris: '["https://example.com/cb"]',
    grantTypes: '["authorization_code"]',
    responseTypes: '["code"]',
    allowedScopes: '["openid"]',
    ownerAccountId: null,
    registrationAccessTokenHash: null,
    status: "active",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  })) as any;

  const result = await validateAuthorizationRequest(d1, {
    response_type: "code",
    client_id: "client-1",
    redirect_uri: "https://evil.com/cb",
  });

  assertEquals(result.valid, false);
  assertEquals(result.error, "invalid_request");
  assertErrorDescriptionIncludes(result, "redirect_uri not registered");
});
Deno.test("validateAuthorizationRequest - rejects missing state", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mocks.getDb = (() => db) as any;
  db._.get = (async () => ({
    id: "int-1",
    clientId: "client-1",
    clientSecretHash: null,
    clientType: "public",
    name: "App",
    description: null,
    logoUri: null,
    clientUri: null,
    policyUri: null,
    tosUri: null,
    redirectUris: '["https://example.com/cb"]',
    grantTypes: '["authorization_code"]',
    responseTypes: '["code"]',
    allowedScopes: '["openid"]',
    ownerAccountId: null,
    registrationAccessTokenHash: null,
    status: "active",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  })) as any;

  const result = await validateAuthorizationRequest(d1, {
    response_type: "code",
    client_id: "client-1",
    redirect_uri: "https://example.com/cb",
  });

  assertEquals(result.valid, false);
  assertEquals(result.error, "invalid_request");
  assertErrorDescriptionIncludes(result, "state");
  assertEquals(result.redirectUri, "https://example.com/cb");
});
Deno.test("validateAuthorizationRequest - rejects missing code_challenge (PKCE is required)", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mocks.getDb = (() => db) as any;
  db._.get = (async () => ({
    id: "int-1",
    clientId: "client-1",
    clientSecretHash: null,
    clientType: "public",
    name: "App",
    description: null,
    logoUri: null,
    clientUri: null,
    policyUri: null,
    tosUri: null,
    redirectUris: '["https://example.com/cb"]',
    grantTypes: '["authorization_code"]',
    responseTypes: '["code"]',
    allowedScopes: '["openid"]',
    ownerAccountId: null,
    registrationAccessTokenHash: null,
    status: "active",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  })) as any;

  const result = await validateAuthorizationRequest(d1, {
    response_type: "code",
    client_id: "client-1",
    redirect_uri: "https://example.com/cb",
    state: "some-state",
  });

  assertEquals(result.valid, false);
  assertEquals(result.error, "invalid_request");
  assertErrorDescriptionIncludes(result, "code_challenge");
});
Deno.test("validateAuthorizationRequest - rejects non-S256 code_challenge_method", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mocks.getDb = (() => db) as any;
  db._.get = (async () => ({
    id: "int-1",
    clientId: "client-1",
    clientSecretHash: null,
    clientType: "public",
    name: "App",
    description: null,
    logoUri: null,
    clientUri: null,
    policyUri: null,
    tosUri: null,
    redirectUris: '["https://example.com/cb"]',
    grantTypes: '["authorization_code"]',
    responseTypes: '["code"]',
    allowedScopes: '["openid"]',
    ownerAccountId: null,
    registrationAccessTokenHash: null,
    status: "active",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  })) as any;

  const result = await validateAuthorizationRequest(d1, {
    response_type: "code",
    client_id: "client-1",
    redirect_uri: "https://example.com/cb",
    state: "some-state",
    code_challenge: "A".repeat(43),
    code_challenge_method: "plain" as never,
  });

  assertEquals(result.valid, false);
  assertEquals(result.error, "invalid_request");
  assertErrorDescriptionIncludes(result, "S256");
});
Deno.test("validateAuthorizationRequest - rejects invalid scope", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mocks.getDb = (() => db) as any;
  db._.get = (async () => ({
    id: "int-1",
    clientId: "client-1",
    clientSecretHash: null,
    clientType: "public",
    name: "App",
    description: null,
    logoUri: null,
    clientUri: null,
    policyUri: null,
    tosUri: null,
    redirectUris: '["https://example.com/cb"]',
    grantTypes: '["authorization_code"]',
    responseTypes: '["code"]',
    allowedScopes: '["openid"]',
    ownerAccountId: null,
    registrationAccessTokenHash: null,
    status: "active",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  })) as any;

  const result = await validateAuthorizationRequest(d1, {
    response_type: "code",
    client_id: "client-1",
    redirect_uri: "https://example.com/cb",
    state: "some-state",
    code_challenge: "A".repeat(43),
    code_challenge_method: "S256",
    scope: "openid unknown_scope",
  });

  assertEquals(result.valid, false);
  assertEquals(result.error, "invalid_scope");
});
Deno.test("validateAuthorizationRequest - rejects scopes that exceed client allowed scopes", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mocks.getDb = (() => db) as any;
  db._.get = (async () => ({
    id: "int-1",
    clientId: "client-1",
    clientSecretHash: null,
    clientType: "public",
    name: "App",
    description: null,
    logoUri: null,
    clientUri: null,
    policyUri: null,
    tosUri: null,
    redirectUris: '["https://example.com/cb"]',
    grantTypes: '["authorization_code"]',
    responseTypes: '["code"]',
    allowedScopes: '["openid"]', // Only openid allowed
    ownerAccountId: null,
    registrationAccessTokenHash: null,
    status: "active",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  })) as any;

  const result = await validateAuthorizationRequest(d1, {
    response_type: "code",
    client_id: "client-1",
    redirect_uri: "https://example.com/cb",
    state: "some-state",
    code_challenge: "A".repeat(43),
    code_challenge_method: "S256",
    scope: "openid profile", // profile not in allowed_scopes
  });

  assertEquals(result.valid, false);
  assertEquals(result.error, "invalid_scope");
  assertErrorDescriptionIncludes(result, "exceeds allowed scopes");
});
Deno.test("validateAuthorizationRequest - returns valid for a complete correct request", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mocks.getDb = (() => db) as any;
  db._.get = (async () => ({
    id: "int-1",
    clientId: "client-1",
    clientSecretHash: null,
    clientType: "public",
    name: "App",
    description: null,
    logoUri: null,
    clientUri: null,
    policyUri: null,
    tosUri: null,
    redirectUris: '["https://example.com/cb"]',
    grantTypes: '["authorization_code"]',
    responseTypes: '["code"]',
    allowedScopes: '["openid","profile"]',
    ownerAccountId: null,
    registrationAccessTokenHash: null,
    status: "active",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  })) as any;

  const result = await validateAuthorizationRequest(d1, {
    response_type: "code",
    client_id: "client-1",
    redirect_uri: "https://example.com/cb",
    state: "state123",
    code_challenge: "A".repeat(43),
    code_challenge_method: "S256",
    scope: "openid profile",
  });

  assertEquals(result.valid, true);
  assert(result.client !== undefined);
  assertEquals(result.redirectUri, "https://example.com/cb");
});
// ---------------------------------------------------------------------------
// generateAuthorizationCode
// ---------------------------------------------------------------------------

Deno.test("generateAuthorizationCode - returns a non-empty authorization code string", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mocks.getDb = (() => db) as any;
  db.insert.calls.length = 0;
  // insert().values() resolves via the mock chain
  db._.chain.values = (async () => undefined) as any;

  const code = await generateAuthorizationCode(d1, {
    clientId: "client-1",
    userId: "user-1",
    redirectUri: "https://example.com/cb",
    scope: "openid",
    codeChallenge: "A".repeat(43),
    codeChallengeMethod: "S256",
  });

  assertEquals(typeof code, "string");
  assert(code.length > 0);
});
Deno.test("generateAuthorizationCode - calls db.insert to persist the code", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mocks.getDb = (() => db) as any;
  db.insert.calls.length = 0;
  db._.chain.values = (async () => undefined) as any;

  await generateAuthorizationCode(d1, {
    clientId: "client-1",
    userId: "user-1",
    redirectUri: "https://example.com/cb",
    scope: "openid",
    codeChallenge: "A".repeat(43),
    codeChallengeMethod: "S256",
  });

  assert(db.insert.calls.length > 0);
});
// ---------------------------------------------------------------------------
// exchangeAuthorizationCode
// ---------------------------------------------------------------------------

// Helper: create a stored auth code row that matches a given plaintext code
async function buildStoredCodeRow(
  code: string,
  overrides: Record<string, unknown> = {},
) {
  const codeHash = await computeSHA256(code);
  const codeVerifier = generateCodeVerifier();
  const codeChallenge = await generateCodeChallenge(codeVerifier, "S256");

  return {
    row: {
      id: "code-id-1",
      codeHash,
      clientId: "client-1",
      accountId: "user-1",
      redirectUri: "https://example.com/cb",
      scope: "openid",
      codeChallenge,
      codeChallengeMethod: "S256",
      used: false,
      expiresAt: new Date(Date.now() + 600_000).toISOString(),
      createdAt: new Date().toISOString(),
      ...overrides,
    },
    codeVerifier,
    codeChallenge,
  };
}
Deno.test("exchangeAuthorizationCode - returns invalid_grant when code is not found", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mocks.getDb = (() => db) as any;
  db._.get = (async () => null) as any;

  const result = await exchangeAuthorizationCode(d1, {
    code: "nonexistent-code",
    clientId: "client-1",
    redirectUri: "https://example.com/cb",
    codeVerifier: "dummy-verifier",
  });

  assertEquals(result.valid, false);
  assertEquals(result.error, "invalid_grant");
  assertErrorDescriptionIncludes(result, "not found");
});
Deno.test("exchangeAuthorizationCode - returns invalid_grant and revokes tokens when code was already used", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mocks.getDb = (() => db) as any;
  const code = "used-code-value";
  const { row } = await buildStoredCodeRow(code, { used: true });

  db._.get = (async () => row) as any;
  mocks.revokeTokensByAuthorizationCode.calls.length = 0;
  authorizationDeps.revokeTokensByAuthorizationCode = mocks.revokeTokensByAuthorizationCode as typeof authorizationDeps.revokeTokensByAuthorizationCode;

  try {
    const result = await exchangeAuthorizationCode(d1, {
      code,
      clientId: "client-1",
      redirectUri: "https://example.com/cb",
      codeVerifier: "dummy-verifier",
    });

    assertEquals(result.valid, false);
    assertEquals(result.error, "invalid_grant");
    assertErrorDescriptionIncludes(result, "already used");
    assertEquals(mocks.revokeTokensByAuthorizationCode.calls[0][1], "code-id-1");
  } finally {
    Object.assign(authorizationDeps, originalAuthorizationDeps);
  }
});
Deno.test("exchangeAuthorizationCode - returns invalid_grant when code is expired", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mocks.getDb = (() => db) as any;
  const code = "expired-code-value";
  const { row, codeVerifier } = await buildStoredCodeRow(code, {
    expiresAt: new Date(Date.now() - 10_000).toISOString(), // expired 10s ago
  });

  db._.get = (async () => row) as any;

  const result = await exchangeAuthorizationCode(d1, {
    code,
    clientId: row.clientId,
    redirectUri: row.redirectUri,
    codeVerifier,
  });

  assertEquals(result.valid, false);
  assertEquals(result.error, "invalid_grant");
  assertErrorDescriptionIncludes(result, "expired");
});
Deno.test("exchangeAuthorizationCode - returns invalid_grant when client_id mismatches", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mocks.getDb = (() => db) as any;
  const code = "client-mismatch-code";
  const { row, codeVerifier } = await buildStoredCodeRow(code);

  db._.get = (async () => row) as any;

  const result = await exchangeAuthorizationCode(d1, {
    code,
    clientId: "wrong-client-id",
    redirectUri: row.redirectUri,
    codeVerifier,
  });

  assertEquals(result.valid, false);
  assertEquals(result.error, "invalid_grant");
  assertErrorDescriptionIncludes(result, "Client ID mismatch");
});
Deno.test("exchangeAuthorizationCode - returns invalid_grant when redirect_uri mismatches", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mocks.getDb = (() => db) as any;
  const code = "redirect-mismatch-code";
  const { row, codeVerifier } = await buildStoredCodeRow(code);

  db._.get = (async () => row) as any;

  const result = await exchangeAuthorizationCode(d1, {
    code,
    clientId: row.clientId,
    redirectUri: "https://evil.com/cb",
    codeVerifier,
  });

  assertEquals(result.valid, false);
  assertEquals(result.error, "invalid_grant");
  assertErrorDescriptionIncludes(result, "Redirect URI mismatch");
});
Deno.test("exchangeAuthorizationCode - returns invalid_grant when PKCE verification fails (wrong verifier)", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mocks.getDb = (() => db) as any;
  const code = "pkce-fail-code";
  const { row } = await buildStoredCodeRow(code);

  db._.get = (async () => row) as any;

  // Use a deliberately wrong code_verifier
  const result = await exchangeAuthorizationCode(d1, {
    code,
    clientId: row.clientId,
    redirectUri: row.redirectUri,
    codeVerifier: "wrong-verifier-that-does-not-match-challenge-at-all",
  });

  assertEquals(result.valid, false);
  assertEquals(result.error, "invalid_grant");
  assertErrorDescriptionIncludes(result, "PKCE verification failed");
});
Deno.test("exchangeAuthorizationCode - returns valid with the authorization code on successful exchange", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mocks.getDb = (() => db) as any;
  const code = "valid-exchange-code";
  const { row, codeVerifier } = await buildStoredCodeRow(code);

  db._.get = (async () => row) as any;

  // db.update().set().where() should resolve with changes: 1 (CAS success)
  // The default mock already returns { meta: { changes: 1 } }

  const result = await exchangeAuthorizationCode(d1, {
    code,
    clientId: row.clientId,
    redirectUri: row.redirectUri,
    codeVerifier,
  });

  assertEquals(result.valid, true);
  assert(result.code !== undefined);
  assertEquals(result.code!.client_id, "client-1");
  assertEquals(result.code!.user_id, "user-1");
  assertEquals(result.code!.scope, "openid");
});
Deno.test("exchangeAuthorizationCode - returns invalid_grant when CAS update returns zero changes (race condition)", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mocks.getDb = (() => db) as any;
  const code = "race-condition-code";
  const { row, codeVerifier } = await buildStoredCodeRow(code);

  db._.get = (async () => row) as any;
  mocks.revokeTokensByAuthorizationCode.calls.length = 0;
  authorizationDeps.revokeTokensByAuthorizationCode = mocks.revokeTokensByAuthorizationCode as typeof authorizationDeps.revokeTokensByAuthorizationCode;

  // Override the update mock to simulate zero changes (another process used the code)
  db.update = (() => ({
    set: () => ({
      where: async () => ({ meta: { changes: 0 } }),
    }),
  })) as any;

  try {
    const result = await exchangeAuthorizationCode(d1, {
      code,
      clientId: row.clientId,
      redirectUri: row.redirectUri,
      codeVerifier,
    });

    assertEquals(result.valid, false);
    assertEquals(result.error, "invalid_grant");
    assertErrorDescriptionIncludes(result, "already used");
    assert(mocks.revokeTokensByAuthorizationCode.calls.length > 0);
  } finally {
    Object.assign(authorizationDeps, originalAuthorizationDeps);
  }
});
