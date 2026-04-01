import { Buffer } from "node:buffer";
import * as crypto from "node:crypto";
import { verifyServiceToken } from "../jwt.ts";

import {
  assert,
  assertEquals,
  assertNotEquals,
  assertStringIncludes,
} from "jsr:@std/assert";

function generateTestKeyPair(modulusLength = 1024) {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("rsa", {
    modulusLength,
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });
  return { privateKey, publicKey };
}

/**
 * テスト用トークンを署名するローカルヘルパー
 * （未 export、テスト専用）
 */
function signTestToken(options: {
  issuer: string;
  subject: string;
  audience: string;
  privateKey: string;
  kid?: string;
  expiresInSeconds?: number;
  customClaims?: Record<string, unknown>;
}): string {
  const {
    issuer,
    subject,
    audience,
    privateKey,
    kid,
    expiresInSeconds = 60,
    customClaims = {},
  } = options;

  const now = Math.floor(Date.now() / 1000);

  const header: Record<string, string> = { alg: "RS256", typ: "JWT" };
  if (kid) header.kid = kid;

  const RESERVED_CLAIMS = new Set(["iss", "sub", "aud", "iat", "exp", "jti"]);
  const filteredCustomClaims: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(customClaims)) {
    if (!RESERVED_CLAIMS.has(key)) {
      filteredCustomClaims[key] = value;
    }
  }

  const payload = {
    ...filteredCustomClaims,
    iss: issuer,
    sub: subject,
    aud: audience,
    iat: now,
    exp: now + expiresInSeconds,
    jti: crypto.randomBytes(16).toString("base64url"),
  };

  const encodedHeader = Buffer.from(JSON.stringify(header)).toString(
    "base64url",
  );
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString(
    "base64url",
  );
  const signingInput = `${encodedHeader}.${encodedPayload}`;

  const sign = crypto.createSign("RSA-SHA256");
  sign.update(signingInput);
  sign.end();
  const signature = sign.sign(privateKey);
  const encodedSignature = signature.toString("base64url");

  return `${signingInput}.${encodedSignature}`;
}

function decodeToken(
  token: string,
):
  | { header: Record<string, unknown>; payload: Record<string, unknown> }
  | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  try {
    const header = JSON.parse(
      Buffer.from(parts[0], "base64url").toString("utf-8"),
    );
    const payload = JSON.parse(
      Buffer.from(parts[1], "base64url").toString("utf-8"),
    );
    return { header, payload };
  } catch {
    return null;
  }
}

Deno.test("service JWT - signs and verifies a valid RS256 token", () => {
  const { privateKey, publicKey } = generateTestKeyPair(1024);

  const token = signTestToken({
    issuer: "takos-control",
    subject: "service-runtime",
    audience: "takos-runtime",
    privateKey,
    expiresInSeconds: 120,
    customClaims: { role: "internal" },
  });

  const result = verifyServiceToken({
    token,
    publicKey,
    expectedAudience: "takos-runtime",
    expectedIssuer: "takos-control",
  });

  assertEquals(result.valid, true);
  assertEquals(result.payload?.sub, "service-runtime");
  assertEquals(result.payload?.role, "internal");
});
Deno.test("service JWT - rejects token when audience mismatches", () => {
  const { privateKey, publicKey } = generateTestKeyPair(1024);

  const token = signTestToken({
    issuer: "takos-control",
    subject: "service-runtime",
    audience: "takos-runtime",
    privateKey,
  });

  const result = verifyServiceToken({
    token,
    publicKey,
    expectedAudience: "different-service",
    expectedIssuer: "takos-control",
  });

  assertEquals(result.valid, false);
  assert(typeof result.error === "string");
  assertStringIncludes(result.error, "Invalid audience");
});
Deno.test("service JWT - rejects tampered token payload", () => {
  const { privateKey, publicKey } = generateTestKeyPair(1024);

  const token = signTestToken({
    issuer: "takos-control",
    subject: "service-runtime",
    audience: "takos-runtime",
    privateKey,
  });

  const [header, payload, signature] = token.split(".");
  const tamperedPayload = Buffer.from(JSON.stringify({ aud: "evil" })).toString(
    "base64url",
  );
  const tamperedToken = [header, tamperedPayload, signature].join(".");

  const result = verifyServiceToken({
    token: tamperedToken,
    publicKey,
    expectedAudience: "takos-runtime",
    expectedIssuer: "takos-control",
  });

  assertEquals(result.valid, false);
  assertEquals(result.error, "Invalid signature");
  assertNotEquals(payload, tamperedPayload);
});
Deno.test("service JWT - returns null for malformed token in decodeToken", () => {
  assertEquals(decodeToken("not-a-jwt"), null);
});
Deno.test("service JWT - does not allow reserved claims to be overridden by customClaims", () => {
  const { privateKey, publicKey } = generateTestKeyPair(1024);

  const token = signTestToken({
    issuer: "takos-control",
    subject: "service-runtime",
    audience: "takos-runtime",
    privateKey,
    expiresInSeconds: 120,
    customClaims: {
      iss: "evil-issuer",
      sub: "evil-subject",
      aud: "evil-audience",
      exp: 1,
      iat: 1,
      jti: "evil-jti",
      role: "internal",
    },
  });

  const decoded = decodeToken(token);
  assertNotEquals(decoded, null);

  const payload = decoded?.payload as Record<string, unknown>;

  assertEquals(payload.iss, "takos-control");
  assertEquals(payload.sub, "service-runtime");
  assertEquals(payload.aud, "takos-runtime");
  assertNotEquals(payload.jti, "evil-jti");
  assertNotEquals(payload.iat, 1);
  assertNotEquals(payload.exp, 1);
  assertEquals(payload.exp, (payload.iat as number) + 120);

  // 予約済みでないカスタムクレームはそのまま残る
  assertEquals(payload.role, "internal");

  const verified = verifyServiceToken({
    token,
    publicKey,
    expectedAudience: "takos-runtime",
    expectedIssuer: "takos-control",
  });

  assertEquals(verified.valid, true);
  assertEquals(verified.payload?.role, "internal");
});
