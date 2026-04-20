import * as jose from "jose";
import {
  buildAuthorizationCodeTokenFamily,
  formatOAuthAccessToken,
  generateAccessToken,
  generateRefreshToken,
  generateTokenResponse,
  RefreshTokenReuseDetectedError,
  verifyAccessToken,
} from "@/services/oauth/token";
import type { JsonStringArray, OAuthClient } from "@/types/oauth";
import { OAUTH_CONSTANTS } from "@/types/oauth";
import { createMockEnv } from "../../../../test/integration/setup.ts";

// ---------------------------------------------------------------------------
// Token generation and verification tests
// ---------------------------------------------------------------------------

import { assert, assertEquals, assertNotEquals } from "jsr:@std/assert";

async function createKeyPairPem() {
  const { privateKey, publicKey } = await jose.generateKeyPair("RS256", {
    extractable: true,
  });
  return {
    privateKeyPem: await jose.exportPKCS8(privateKey),
    publicKeyPem: await jose.exportSPKI(publicKey),
  };
}

function jsonArray(value: string[]): JsonStringArray {
  return JSON.stringify(value) as JsonStringArray;
}

function makeClient(overrides: Partial<OAuthClient> = {}): OAuthClient {
  return {
    id: "internal-id",
    client_id: "client-1",
    client_secret_hash: null,
    client_type: "public",
    name: "Test Client",
    description: null,
    logo_uri: null,
    client_uri: null,
    policy_uri: null,
    tos_uri: null,
    redirect_uris: jsonArray(["https://example.com/callback"]),
    grant_types: jsonArray(["authorization_code", "refresh_token"]),
    response_types: jsonArray(["code"]),
    allowed_scopes: jsonArray(["openid", "profile"]),
    owner_id: null,
    registration_access_token_hash: null,
    status: "active",
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

Deno.test("generateAccessToken - generates a valid JWT with correct claims", async () => {
  const { privateKeyPem, publicKeyPem } = await createKeyPairPem();
  const { token, jti, expiresAt } = await generateAccessToken({
    privateKeyPem,
    issuer: "https://admin.takos.test",
    userId: "user-1",
    clientId: "client-1",
    scope: "openid profile",
  });

  assert(token);
  assert(jti);
  assert(expiresAt instanceof Date);
  assert(expiresAt.getTime() > Date.now());

  // Verify the token
  const payload = await verifyAccessToken({
    token: formatOAuthAccessToken(token),
    publicKeyPem,
    issuer: "https://admin.takos.test",
  });

  assertNotEquals(payload, null);
  assertEquals(payload!.iss, "https://admin.takos.test");
  assertEquals(payload!.sub, "user-1");
  assertEquals(payload!.aud, "client-1");
  assertEquals(payload!.client_id, "client-1");
  assertEquals(payload!.scope, "openid profile");
  assertEquals(payload!.jti, jti);
});
Deno.test("generateTokenResponse - returns a tak_oat-prefixed public access token", async () => {
  const { privateKeyPem, publicKeyPem } = await createKeyPairPem();
  const env = createMockEnv();
  const response = await generateTokenResponse(
    env.DB as unknown as Parameters<typeof generateTokenResponse>[0],
    {
      privateKeyPem,
      issuer: "https://admin.takos.test",
      userId: "user-1",
      client: makeClient(),
      scope: "openid profile",
    },
  );

  assert(response.access_token.startsWith("tak_oat_"));
  assert(response.refresh_token);
  assert(!response.refresh_token.startsWith("tak_oat_"));

  const payload = await verifyAccessToken({
    token: response.access_token,
    publicKeyPem,
    issuer: "https://admin.takos.test",
  });
  assertNotEquals(payload, null);
  assertEquals(payload!.sub, "user-1");
  assertEquals(payload!.client_id, "client-1");
});
Deno.test("OAuth access token formatter is idempotent and public verifier rejects raw JWTs", async () => {
  const { privateKeyPem, publicKeyPem } = await createKeyPairPem();
  const { token } = await generateAccessToken({
    privateKeyPem,
    issuer: "https://admin.takos.test",
    userId: "user-1",
    clientId: "client-1",
    scope: "openid profile",
  });

  const prefixed = formatOAuthAccessToken(token);
  assert(prefixed.startsWith("tak_oat_"));
  assertEquals(formatOAuthAccessToken(prefixed), prefixed);

  const rawPayload = await verifyAccessToken({
    token,
    publicKeyPem,
    issuer: "https://admin.takos.test",
  });
  const prefixedPayload = await verifyAccessToken({
    token: prefixed,
    publicKeyPem,
    issuer: "https://admin.takos.test",
  });

  assertEquals(rawPayload, null);
  assertNotEquals(prefixedPayload, null);
  assertEquals(prefixedPayload?.client_id, "client-1");
});
Deno.test("generateAccessToken - uses default expiry of ACCESS_TOKEN_EXPIRES_IN seconds", async () => {
  const { privateKeyPem } = await createKeyPairPem();
  const before = Math.floor(Date.now() / 1000);
  const { expiresAt } = await generateAccessToken({
    privateKeyPem,
    issuer: "https://admin.takos.test",
    userId: "user-1",
    clientId: "client-1",
    scope: "openid",
  });
  const after = Math.floor(Date.now() / 1000);

  const expiresAtSec = Math.floor(expiresAt.getTime() / 1000);
  assert(expiresAtSec >= before + OAUTH_CONSTANTS.ACCESS_TOKEN_EXPIRES_IN);
  assert(expiresAtSec <= after + OAUTH_CONSTANTS.ACCESS_TOKEN_EXPIRES_IN + 1);
});
Deno.test("generateAccessToken - supports custom expiry", async () => {
  const { privateKeyPem } = await createKeyPairPem();
  const customExpiry = 600;
  const before = Math.floor(Date.now() / 1000);
  const { expiresAt } = await generateAccessToken({
    privateKeyPem,
    issuer: "https://admin.takos.test",
    userId: "user-1",
    clientId: "client-1",
    scope: "openid",
    expiresInSeconds: customExpiry,
  });

  const expiresAtSec = Math.floor(expiresAt.getTime() / 1000);
  assert(expiresAtSec >= before + customExpiry);
  assert(expiresAtSec <= before + customExpiry + 2);
});
Deno.test("generateAccessToken - sets at+jwt type header", async () => {
  const { privateKeyPem } = await createKeyPairPem();
  const { token } = await generateAccessToken({
    privateKeyPem,
    issuer: "https://admin.takos.test",
    userId: "user-1",
    clientId: "client-1",
    scope: "openid",
  });

  const header = jose.decodeProtectedHeader(token);
  assertEquals(header.alg, "RS256");
  assertEquals(header.typ, "at+jwt");
});

Deno.test("verifyAccessToken - returns null for an expired token", async () => {
  const { privateKeyPem, publicKeyPem } = await createKeyPairPem();
  const { token } = await generateAccessToken({
    privateKeyPem,
    issuer: "https://admin.takos.test",
    userId: "user-1",
    clientId: "client-1",
    scope: "openid",
    expiresInSeconds: -1, // already expired
  });

  const payload = await verifyAccessToken({
    token: formatOAuthAccessToken(token),
    publicKeyPem,
    issuer: "https://admin.takos.test",
  });

  assertEquals(payload, null);
});
Deno.test("verifyAccessToken - returns null for wrong issuer", async () => {
  const { privateKeyPem, publicKeyPem } = await createKeyPairPem();
  const { token } = await generateAccessToken({
    privateKeyPem,
    issuer: "https://admin.takos.test",
    userId: "user-1",
    clientId: "client-1",
    scope: "openid",
  });

  const payload = await verifyAccessToken({
    token: formatOAuthAccessToken(token),
    publicKeyPem,
    issuer: "https://wrong-issuer.test",
  });

  assertEquals(payload, null);
});
Deno.test("verifyAccessToken - returns null for a tampered token", async () => {
  const { privateKeyPem, publicKeyPem } = await createKeyPairPem();
  const { token } = await generateAccessToken({
    privateKeyPem,
    issuer: "https://admin.takos.test",
    userId: "user-1",
    clientId: "client-1",
    scope: "openid",
  });

  const tampered = token.slice(0, -5) + "XXXXX";

  const payload = await verifyAccessToken({
    token: formatOAuthAccessToken(tampered),
    publicKeyPem,
    issuer: "https://admin.takos.test",
  });

  assertEquals(payload, null);
});
Deno.test("verifyAccessToken - returns null for a token signed with a different key", async () => {
  const { publicKeyPem } = await createKeyPairPem();
  const otherKeys = await jose.generateKeyPair("RS256", { extractable: true });
  const otherPrivateKeyPem = await jose.exportPKCS8(otherKeys.privateKey);

  const { token } = await generateAccessToken({
    privateKeyPem: otherPrivateKeyPem,
    issuer: "https://admin.takos.test",
    userId: "user-1",
    clientId: "client-1",
    scope: "openid",
  });

  const payload = await verifyAccessToken({
    token: formatOAuthAccessToken(token),
    publicKeyPem, // original key, not the one used to sign
    issuer: "https://admin.takos.test",
  });

  assertEquals(payload, null);
});
Deno.test("verifyAccessToken - enforces audience when expectedAudience is provided", async () => {
  const { privateKeyPem, publicKeyPem } = await createKeyPairPem();
  const { token } = await generateAccessToken({
    privateKeyPem,
    issuer: "https://admin.takos.test",
    userId: "user-1",
    clientId: "client-a",
    scope: "openid",
  });

  const correct = await verifyAccessToken({
    token: formatOAuthAccessToken(token),
    publicKeyPem,
    issuer: "https://admin.takos.test",
    expectedAudience: "client-a",
  });
  assertNotEquals(correct, null);

  const wrong = await verifyAccessToken({
    token: formatOAuthAccessToken(token),
    publicKeyPem,
    issuer: "https://admin.takos.test",
    expectedAudience: "client-b",
  });
  assertEquals(wrong, null);
});
Deno.test("verifyAccessToken - returns null for completely garbage input", async () => {
  const { publicKeyPem } = await createKeyPairPem();
  const payload = await verifyAccessToken({
    token: "tak_oat_not-a-jwt",
    publicKeyPem,
    issuer: "https://admin.takos.test",
  });

  assertEquals(payload, null);
});

Deno.test("generateRefreshToken - returns a token string and expiry date", () => {
  const { token, expiresAt } = generateRefreshToken();

  assertEquals(typeof token, "string");
  assert(token.length > 0);
  assert(expiresAt instanceof Date);
  assert(expiresAt.getTime() > Date.now());
});
Deno.test("generateRefreshToken - uses REFRESH_TOKEN_EXPIRES_IN for expiry", () => {
  const before = Date.now();
  const { expiresAt } = generateRefreshToken();
  const after = Date.now();

  const expectedMinMs = before +
    OAUTH_CONSTANTS.REFRESH_TOKEN_EXPIRES_IN * 1000;
  const expectedMaxMs = after + OAUTH_CONSTANTS.REFRESH_TOKEN_EXPIRES_IN * 1000;

  assert(expiresAt.getTime() >= expectedMinMs);
  assert(expiresAt.getTime() <= expectedMaxMs + 100);
});
Deno.test("generateRefreshToken - generates unique tokens", () => {
  const a = generateRefreshToken();
  const b = generateRefreshToken();
  assertNotEquals(a.token, b.token);
});

Deno.test("buildAuthorizationCodeTokenFamily - prefixes with auth_code:", () => {
  assertEquals(
    buildAuthorizationCodeTokenFamily("code-123"),
    "auth_code:code-123",
  );
});

Deno.test("RefreshTokenReuseDetectedError - has the correct name and message", () => {
  const error = new RefreshTokenReuseDetectedError();
  assertEquals(error.name, "RefreshTokenReuseDetectedError");
  assertEquals(error.message, "refresh_token_reuse_detected");
  assert(error instanceof Error);
});
