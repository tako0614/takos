import * as jose from "jose";
import {
  formatOAuthAccessToken,
  generateAccessToken,
  verifyAccessToken,
} from "@/services/oauth/token";

import { assertEquals, assertNotEquals } from "jsr:@std/assert";

const issuer = "https://admin.takos.test";
const userId = "user-1";
const tokenAudience = "client-a";
const mismatchedAudience = "client-b";

let privateKeyPem: string;
let publicKeyPem: string;
async function issueAccessToken(clientId = tokenAudience): Promise<string> {
  const { token } = await generateAccessToken({
    privateKeyPem,
    issuer,
    userId,
    clientId,
    scope: "openid profile",
  });
  return formatOAuthAccessToken(token);
}

Deno.test("verifyAccessToken audience enforcement (issue 008) - returns payload when expectedAudience matches token audience", async () => {
  const { privateKey, publicKey } = await jose.generateKeyPair("RS256", {
    extractable: true,
  });
  privateKeyPem = await jose.exportPKCS8(privateKey);
  publicKeyPem = await jose.exportSPKI(publicKey);
  const token = await issueAccessToken(tokenAudience);

  const payload = await verifyAccessToken({
    token,
    publicKeyPem,
    issuer,
    expectedAudience: tokenAudience,
  });

  assertNotEquals(payload, null);
  assertEquals(payload?.aud, tokenAudience);
  assertEquals(payload?.client_id, tokenAudience);
});
Deno.test("verifyAccessToken audience enforcement (issue 008) - returns null when expectedAudience mismatches token audience", async () => {
  const { privateKey, publicKey } = await jose.generateKeyPair("RS256", {
    extractable: true,
  });
  privateKeyPem = await jose.exportPKCS8(privateKey);
  publicKeyPem = await jose.exportSPKI(publicKey);
  const token = await issueAccessToken(tokenAudience);

  const payload = await verifyAccessToken({
    token,
    publicKeyPem,
    issuer,
    expectedAudience: mismatchedAudience,
  });

  assertEquals(payload, null);
});
Deno.test("verifyAccessToken audience enforcement (issue 008) - returns payload when expectedAudience is omitted", async () => {
  const { privateKey, publicKey } = await jose.generateKeyPair("RS256", {
    extractable: true,
  });
  privateKeyPem = await jose.exportPKCS8(privateKey);
  publicKeyPem = await jose.exportSPKI(publicKey);
  const token = await issueAccessToken(tokenAudience);

  const payload = await verifyAccessToken({
    token,
    publicKeyPem,
    issuer,
  });

  assertNotEquals(payload, null);
  assertEquals(payload?.aud, tokenAudience);
  assertEquals(payload?.client_id, tokenAudience);
});
