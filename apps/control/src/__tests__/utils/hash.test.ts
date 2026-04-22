import {
  computeSHA256,
  constantTimeEqual,
  verifyBundleHash,
} from "@/utils/hash";

import { assert, assertEquals, assertNotEquals } from "jsr:@std/assert";

Deno.test("computeSHA256 - hashes a string to a 64-char hex string", async () => {
  const hash = await computeSHA256("hello");
  assertEquals(hash.length, 64);
  assert(/^[0-9a-f]{64}$/.test(hash));
});
Deno.test("computeSHA256 - returns known SHA-256 for empty string", async () => {
  const hash = await computeSHA256("");
  assertEquals(
    hash,
    "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
  );
});
Deno.test('computeSHA256 - returns known SHA-256 for "hello"', async () => {
  const hash = await computeSHA256("hello");
  assertEquals(
    hash,
    "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
  );
});
Deno.test("computeSHA256 - hashes Uint8Array input", async () => {
  const data = new TextEncoder().encode("hello");
  const hash = await computeSHA256(data);
  assertEquals(
    hash,
    "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
  );
});
Deno.test("computeSHA256 - hashes ArrayBuffer input", async () => {
  const data = new TextEncoder().encode("hello").buffer;
  const hash = await computeSHA256(data as ArrayBuffer);
  assertEquals(
    hash,
    "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
  );
});
Deno.test("computeSHA256 - produces different hashes for different inputs", async () => {
  const h1 = await computeSHA256("abc");
  const h2 = await computeSHA256("def");
  assertNotEquals(h1, h2);
});

Deno.test("verifyBundleHash - returns true when hash matches", async () => {
  const content = "test content";
  const hash = await computeSHA256(content);
  assertEquals(await verifyBundleHash(content, hash), true);
});
Deno.test("verifyBundleHash - returns false when hash does not match", async () => {
  assertEquals(await verifyBundleHash("test", "wrong-hash"), false);
});
Deno.test("verifyBundleHash - works with ArrayBuffer content", async () => {
  const content = new TextEncoder().encode("test content");
  const hash = await computeSHA256(content);
  assertEquals(
    await verifyBundleHash(content.buffer as ArrayBuffer, hash),
    true,
  );
});
Deno.test("verifyBundleHash - rejects tampered content", async () => {
  const hash = await computeSHA256("original");
  assertEquals(await verifyBundleHash("tampered", hash), false);
});

Deno.test("constantTimeEqual - returns true for identical strings", () => {
  assertEquals(constantTimeEqual("abc", "abc"), true);
});
Deno.test("constantTimeEqual - returns false for different strings of same length", () => {
  assertEquals(constantTimeEqual("abc", "abd"), false);
});
Deno.test("constantTimeEqual - returns false for different length strings", () => {
  assertEquals(constantTimeEqual("abc", "abcd"), false);
});
Deno.test("constantTimeEqual - returns true for two empty strings", () => {
  assertEquals(constantTimeEqual("", ""), true);
});
Deno.test("constantTimeEqual - returns false when comparing empty to non-empty", () => {
  assertEquals(constantTimeEqual("", "a"), false);
  assertEquals(constantTimeEqual("a", ""), false);
});
Deno.test("constantTimeEqual - returns false for strings differing only in last char", () => {
  assertEquals(constantTimeEqual("abcde", "abcdf"), false);
});
Deno.test("constantTimeEqual - returns false for strings differing only in first char", () => {
  assertEquals(constantTimeEqual("xbcde", "abcde"), false);
});
