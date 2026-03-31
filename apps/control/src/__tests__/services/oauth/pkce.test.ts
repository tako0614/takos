import {
  generateCodeChallenge,
  generateCodeVerifier,
  generateId,
  generateRandomString,
  isValidCodeChallenge,
  isValidCodeVerifier,
  verifyCodeChallenge,
} from "@/services/oauth/pkce";

import {
  assert,
  assertEquals,
  assertNotEquals,
  assertRejects,
} from "jsr:@std/assert";

Deno.test("generateCodeVerifier - produces a base64url-encoded string", () => {
  const verifier = generateCodeVerifier();
  assertEquals(typeof verifier, "string");
  assert(verifier.length >= 43);
  // base64url characters only
  assert(/^[A-Za-z0-9_-]+$/.test(verifier));
});
Deno.test("generateCodeVerifier - produces unique verifiers", () => {
  const a = generateCodeVerifier();
  const b = generateCodeVerifier();
  assertNotEquals(a, b);
});

Deno.test("generateCodeChallenge - produces a 43-character base64url challenge for S256", async () => {
  const verifier = generateCodeVerifier();
  const challenge = await generateCodeChallenge(verifier, "S256");
  assertEquals(challenge.length, 43);
  assert(/^[A-Za-z0-9_-]+$/.test(challenge));
});
Deno.test("generateCodeChallenge - produces different challenges for different verifiers", async () => {
  const a = await generateCodeChallenge("verifier-aaa", "S256");
  const b = await generateCodeChallenge("verifier-bbb", "S256");
  assertNotEquals(a, b);
});
Deno.test("generateCodeChallenge - produces the same challenge for the same verifier (deterministic)", async () => {
  const verifier = "deterministic-test-verifier-1234567890abcdef";
  const a = await generateCodeChallenge(verifier, "S256");
  const b = await generateCodeChallenge(verifier, "S256");
  assertEquals(a, b);
});
Deno.test("generateCodeChallenge - throws for unsupported methods", async () => {
  await assertRejects(async () => {
    await generateCodeChallenge("verifier", "plain" as never);
  }, "Unsupported PKCE code challenge method");
});

Deno.test("verifyCodeChallenge - returns true when verifier matches the challenge", async () => {
  const verifier = generateCodeVerifier();
  const challenge = await generateCodeChallenge(verifier, "S256");
  const result = await verifyCodeChallenge(verifier, challenge, "S256");
  assertEquals(result, true);
});
Deno.test("verifyCodeChallenge - returns false when verifier does not match", async () => {
  const challenge = await generateCodeChallenge(
    "correct-verifier-1234567890abcd",
    "S256",
  );
  const result = await verifyCodeChallenge(
    "wrong-verifier-1234567890abcdef",
    challenge,
    "S256",
  );
  assertEquals(result, false);
});
Deno.test("verifyCodeChallenge - uses S256 as default method", async () => {
  const verifier = generateCodeVerifier();
  const challenge = await generateCodeChallenge(verifier);
  const result = await verifyCodeChallenge(verifier, challenge);
  assertEquals(result, true);
});

Deno.test("isValidCodeVerifier - accepts verifiers between 43 and 128 characters", () => {
  assertEquals(isValidCodeVerifier("a".repeat(43)), true);
  assertEquals(isValidCodeVerifier("a".repeat(128)), true);
  assertEquals(isValidCodeVerifier("a".repeat(80)), true);
});
Deno.test("isValidCodeVerifier - rejects verifiers shorter than 43 characters", () => {
  assertEquals(isValidCodeVerifier("a".repeat(42)), false);
  assertEquals(isValidCodeVerifier(""), false);
});
Deno.test("isValidCodeVerifier - rejects verifiers longer than 128 characters", () => {
  assertEquals(isValidCodeVerifier("a".repeat(129)), false);
});
Deno.test("isValidCodeVerifier - accepts unreserved URI characters: alphanumeric, hyphen, period, underscore, tilde", () => {
  assertEquals(
    isValidCodeVerifier("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopq"),
    true,
  );
  assertEquals(isValidCodeVerifier("0123456789-._~" + "a".repeat(29)), true);
});
Deno.test("isValidCodeVerifier - rejects verifiers with invalid characters", () => {
  assertEquals(isValidCodeVerifier("a".repeat(43) + "!"), false);
  assertEquals(isValidCodeVerifier("a".repeat(43) + " "), false);
  assertEquals(isValidCodeVerifier("a".repeat(43) + "+"), false);
});

Deno.test("isValidCodeChallenge - accepts exactly 43 character base64url strings", () => {
  assertEquals(isValidCodeChallenge("A".repeat(43)), true);
  assertEquals(
    isValidCodeChallenge("abcdefghijklmnopqrstuvwxyz0123456789_-ABCDE"),
    true,
  );
});
Deno.test("isValidCodeChallenge - rejects challenges that are not exactly 43 characters", () => {
  assertEquals(isValidCodeChallenge("A".repeat(42)), false);
  assertEquals(isValidCodeChallenge("A".repeat(44)), false);
  assertEquals(isValidCodeChallenge(""), false);
});
Deno.test("isValidCodeChallenge - rejects challenges with non-base64url characters", () => {
  assertEquals(isValidCodeChallenge("A".repeat(42) + "+"), false);
  assertEquals(isValidCodeChallenge("A".repeat(42) + "="), false);
  assertEquals(isValidCodeChallenge("A".repeat(42) + "/"), false);
});

Deno.test("generateRandomString - produces a base64url-encoded string", () => {
  const str = generateRandomString(32);
  assertEquals(typeof str, "string");
  assert(/^[A-Za-z0-9_-]+$/.test(str));
});
Deno.test("generateRandomString - produces unique strings", () => {
  const a = generateRandomString(32);
  const b = generateRandomString(32);
  assertNotEquals(a, b);
});

Deno.test("generateId - produces a UUID-like string", () => {
  const id = generateId();
  assert(
    /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(id),
  );
});
Deno.test("generateId - produces unique IDs", () => {
  const ids = new Set(Array.from({ length: 100 }, () => generateId()));
  assertEquals(ids.size, 100);
});
