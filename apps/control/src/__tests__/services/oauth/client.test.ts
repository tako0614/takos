import type {
  JsonStringArray,
  OAuthClient,
} from "../../../../../../packages/control/src/shared/types/oauth.ts";
import {
  getClientAllowedScopes,
  getClientRedirectUris,
  supportsGrantType,
  validateRedirectUri,
  validateRedirectUris,
} from "../../../../../../packages/control/src/application/services/oauth/client.ts";

import { assertEquals, assertNotEquals, assertThrows } from "jsr:@std/assert";

function jsonArray(value: string[]): JsonStringArray {
  return JSON.stringify(value) as JsonStringArray;
}

function makeClient(overrides: Partial<OAuthClient> = {}): OAuthClient {
  return {
    id: "internal-id",
    client_id: "test-client-id",
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

Deno.test("validateRedirectUri - returns true for registered URI and false otherwise", () => {
  const client = makeClient();
  assertEquals(
    validateRedirectUri(client, "https://example.com/callback"),
    true,
  );
  assertEquals(validateRedirectUri(client, "https://evil.com/callback"), false);
});

Deno.test("validateRedirectUris - accepts valid URIs", () => {
  validateRedirectUris([
    "https://example.com/callback",
    "http://localhost:3000/callback",
    "http://127.0.0.1:8080/callback",
    "http://[::1]:3000/callback",
    "http://sub.localhost/callback",
  ]);
});

Deno.test("validateRedirectUris - rejects invalid inputs", () => {
  assertThrows(
    () => validateRedirectUris([]),
    Error,
    "At least one redirect_uri is required",
  );
  assertThrows(
    () => validateRedirectUris(["http://example.com/callback"]),
    Error,
    "must use HTTPS",
  );
  assertThrows(
    () => validateRedirectUris(["https://example.com/callback#fragment"]),
    Error,
    "fragment not allowed",
  );
  assertThrows(
    () => validateRedirectUris(["not-a-url"]),
    Error,
    "Invalid redirect_uri",
  );
});

Deno.test("supportsGrantType - checks JSON encoded grant types", () => {
  const client = makeClient({
    grant_types: jsonArray(["authorization_code"]),
  });
  assertEquals(supportsGrantType(client, "authorization_code"), true);
  assertEquals(supportsGrantType(client, "refresh_token"), false);
});

Deno.test("getClientAllowedScopes - parses the scopes array", () => {
  const client = makeClient({
    allowed_scopes: jsonArray(["openid", "profile", "spaces:read"]),
  });
  assertEquals(getClientAllowedScopes(client), [
    "openid",
    "profile",
    "spaces:read",
  ]);
});

Deno.test("getClientRedirectUris - parses redirect URIs", () => {
  const client = makeClient({
    redirect_uris: jsonArray(["https://a.com/cb", "https://b.com/cb"]),
  });
  assertEquals(getClientRedirectUris(client), [
    "https://a.com/cb",
    "https://b.com/cb",
  ]);
});

Deno.test("getClientRedirectUris - returns empty array for invalid JSON", () => {
  const client = makeClient({ redirect_uris: "bad" as JsonStringArray });
  assertEquals(getClientRedirectUris(client), []);
});

Deno.test("validateRedirectUri - exact matching is preserved", () => {
  const client = makeClient({
    redirect_uris: jsonArray(["https://example.com/callback"]),
  });
  assertNotEquals(
    validateRedirectUri(client, "https://example.com/callback/"),
    true,
  );
});
