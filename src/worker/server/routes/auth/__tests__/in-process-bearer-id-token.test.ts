import { test } from "bun:test";
import { assertEquals } from "@takos/test/assert";
import * as jose from "jose";
import type { Env } from "../../../../shared/types/index.ts";
import type { SqlDatabaseBinding } from "../../../../shared/types/bindings.ts";
import {
  isOidcIdToken,
  resolveSelfIssuedBearer,
} from "../in-process-bearer.ts";

/**
 * Security guard: the in-process accounts plane is the OIDC issuer and signs
 * id_tokens with the same key the verifier loads from /oauth/jwks, but it only
 * mints OPAQUE access tokens (takat_...). An id_token must therefore never be
 * accepted as a full API access token on the self-issued Bearer path. A
 * regression that dropped the id_token rejection would let anyone replay a
 * captured id_token as `Authorization: Bearer <id_token>` and authenticate as
 * the user on every requireAuth route.
 */

const ISSUER = "https://issuer.example.test";

test("isOidcIdToken rejects an id_token (aud=client_id, no scope)", () => {
  assertEquals(
    isOidcIdToken({ iss: ISSUER, sub: "tsub_1", aud: "takos-client" }),
    true,
  );
});

test("isOidcIdToken rejects an id_token carrying nonce / auth_time", () => {
  assertEquals(
    isOidcIdToken({ iss: ISSUER, sub: "tsub_1", nonce: "n" } as jose.JWTPayload),
    true,
  );
  assertEquals(
    isOidcIdToken(
      { iss: ISSUER, sub: "tsub_1", auth_time: 1 } as jose.JWTPayload,
    ),
    true,
  );
});

test("isOidcIdToken allows a JWT that positively declares itself an access token", () => {
  assertEquals(
    isOidcIdToken(
      { iss: ISSUER, sub: "tsub_1", aud: "resource", scope: "profile" } as
        jose.JWTPayload,
    ),
    false,
  );
  assertEquals(
    isOidcIdToken(
      { iss: ISSUER, sub: "tsub_1", token_use: "access" } as jose.JWTPayload,
    ),
    false,
  );
});

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

type SigningKey = Awaited<
  ReturnType<typeof jose.generateKeyPair>
>["privateKey"];

async function signedToken(
  privateKey: SigningKey,
  claims: jose.JWTPayload,
): Promise<string> {
  return await new jose.SignJWT(claims)
    .setProtectedHeader({ alg: "ES256", kid: "test-key" })
    .setIssuer(ISSUER)
    .setSubject("tsub_1")
    .setIssuedAt()
    .setExpirationTime("5m")
    .sign(privateKey);
}

test("resolveSelfIssuedBearer rejects an id_token (aud=client_id) signed by the issuer key", async () => {
  const { publicKey, privateKey } = await jose.generateKeyPair("ES256", {
    extractable: true,
  });
  const publicJwk = await jose.exportJWK(publicKey);
  const jwks: jose.JSONWebKeySet = {
    keys: [{ ...publicJwk, alg: "ES256", kid: "test-key" }],
  };

  const idToken = await signedToken(privateKey, {
    aud: "takos-client",
    nonce: "login-nonce",
  });

  const result = await resolveSelfIssuedBearer({
    authorizationHeader: `Bearer ${idToken}`,
    origin: ISSUER,
    issuer: ISSUER,
    db: dbWithIdentity(),
    env: {} as Env,
    loadJwks: async () => jwks,
  });
  // Rejected even though the signature, issuer, and subject all verify.
  assertEquals(result.kind, "invalid");
});

test("resolveSelfIssuedBearer still accepts a scope-bearing access JWT", async () => {
  const { publicKey, privateKey } = await jose.generateKeyPair("ES256", {
    extractable: true,
  });
  const publicJwk = await jose.exportJWK(publicKey);
  const jwks: jose.JSONWebKeySet = {
    keys: [{ ...publicJwk, alg: "ES256", kid: "test-key" }],
  };

  const accessToken = await signedToken(privateKey, { scope: "profile" });

  const result = await resolveSelfIssuedBearer({
    authorizationHeader: `Bearer ${accessToken}`,
    origin: ISSUER,
    issuer: ISSUER,
    db: dbWithIdentity(),
    env: {} as Env,
    loadJwks: async () => jwks,
  });
  assertEquals(result.kind, "ok");
});
