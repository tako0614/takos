import {
  isLocalhostAddress,
  isValidId,
  validateApiUrl,
} from "../src/lib/config-validation.ts";

// ---------------------------------------------------------------------------
// isLocalhostAddress
// ---------------------------------------------------------------------------

import { assertEquals, assertStringIncludes } from "jsr:@std/assert";

Deno.test('isLocalhostAddress - recognizes "localhost"', () => {
  assertEquals(isLocalhostAddress("localhost"), true);
});
Deno.test('isLocalhostAddress - recognizes "LOCALHOST" (case-insensitive)', () => {
  assertEquals(isLocalhostAddress("LOCALHOST"), true);
});
Deno.test("isLocalhostAddress - recognizes 127.0.0.1", () => {
  assertEquals(isLocalhostAddress("127.0.0.1"), true);
});
Deno.test("isLocalhostAddress - recognizes 127.10.20.30 (loopback range)", () => {
  assertEquals(isLocalhostAddress("127.10.20.30"), true);
});
Deno.test("isLocalhostAddress - recognizes IPv6 loopback ::1", () => {
  assertEquals(isLocalhostAddress("::1"), true);
});
Deno.test("isLocalhostAddress - recognizes full IPv6 loopback", () => {
  assertEquals(isLocalhostAddress("0:0:0:0:0:0:0:1"), true);
});
Deno.test("isLocalhostAddress - recognizes bracketed IPv6", () => {
  assertEquals(isLocalhostAddress("[::1]"), true);
});
Deno.test("isLocalhostAddress - rejects non-localhost IPs", () => {
  assertEquals(isLocalhostAddress("192.168.1.1"), false);
});
Deno.test("isLocalhostAddress - rejects domain names", () => {
  assertEquals(isLocalhostAddress("example.com"), false);
});
Deno.test("isLocalhostAddress - rejects 128.0.0.1 (not loopback)", () => {
  assertEquals(isLocalhostAddress("128.0.0.1"), false);
});
Deno.test("isLocalhostAddress - rejects empty string", () => {
  assertEquals(isLocalhostAddress(""), false);
});
// ---------------------------------------------------------------------------
// validateApiUrl
// ---------------------------------------------------------------------------

Deno.test("validateApiUrl - accepts HTTPS on takos.jp", () => {
  const result = validateApiUrl("https://takos.jp");
  assertEquals(result, { valid: true });
});
Deno.test("validateApiUrl - accepts HTTPS on takos.dev", () => {
  const result = validateApiUrl("https://api.takos.dev");
  assertEquals(result, { valid: true });
});
Deno.test("validateApiUrl - accepts HTTPS on takos.io", () => {
  const result = validateApiUrl("https://takos.io");
  assertEquals(result, { valid: true });
});
Deno.test("validateApiUrl - accepts HTTPS on yurucommu.com", () => {
  const result = validateApiUrl("https://api.yurucommu.com");
  assertEquals(result, { valid: true });
});
Deno.test("validateApiUrl - accepts subdomain of allowed domain", () => {
  const result = validateApiUrl("https://sub.domain.takos.jp");
  assertEquals(result, { valid: true });
});
Deno.test("validateApiUrl - rejects HTTP on non-localhost domain", () => {
  const result = validateApiUrl("http://takos.jp");
  assertEquals(result.valid, false);
  if (!result.valid) {
    assertStringIncludes(result.error ?? "", "HTTPS");
  }
});
Deno.test("validateApiUrl - rejects disallowed domain", () => {
  const result = validateApiUrl("https://example.com");
  assertEquals(result.valid, false);
  if (!result.valid) {
    assertStringIncludes(result.error ?? "", "domain must be one of");
  }
});
Deno.test("validateApiUrl - allows localhost HTTP and marks as insecure", () => {
  const result = validateApiUrl("http://localhost:8787");
  assertEquals(result.valid, true);
  assertEquals(result.insecureLocalhostHttp, true);
});
Deno.test("validateApiUrl - allows 127.0.0.1 HTTP and marks as insecure", () => {
  const result = validateApiUrl("http://127.0.0.1:3000");
  assertEquals(result.valid, true);
  assertEquals(result.insecureLocalhostHttp, true);
});
Deno.test("validateApiUrl - accepts HTTPS on localhost", () => {
  const result = validateApiUrl("https://localhost:8787");
  assertEquals(result.valid, true);
  assertEquals(result.insecureLocalhostHttp, undefined);
});
Deno.test("validateApiUrl - rejects URLs with embedded credentials", () => {
  const result = validateApiUrl("https://user:pass@takos.jp");
  assertEquals(result.valid, false);
  if (!result.valid) {
    assertStringIncludes(result.error ?? "", "credentials");
  }
});
Deno.test("validateApiUrl - rejects URL with only username", () => {
  const result = validateApiUrl("https://user@takos.jp");
  assertEquals(result.valid, false);
  if (!result.valid) {
    assertStringIncludes(result.error ?? "", "credentials");
  }
});
Deno.test("validateApiUrl - rejects invalid URL format", () => {
  const result = validateApiUrl("not-a-url");
  assertEquals(result.valid, false);
  if (!result.valid) {
    assertStringIncludes(result.error ?? "", "Invalid API URL format");
  }
});
Deno.test("validateApiUrl - rejects FTP on non-localhost", () => {
  const result = validateApiUrl("ftp://takos.jp");
  assertEquals(result.valid, false);
});
Deno.test("validateApiUrl - rejects empty string", () => {
  const result = validateApiUrl("");
  assertEquals(result.valid, false);
});
// ---------------------------------------------------------------------------
// isValidId
// ---------------------------------------------------------------------------

Deno.test("isValidId - accepts a valid UUID v4", () => {
  assertEquals(isValidId("550e8400-e29b-41d4-a716-446655440000"), true);
});
Deno.test("isValidId - accepts UUID v4 (uppercase)", () => {
  assertEquals(isValidId("550E8400-E29B-41D4-A716-446655440000"), true);
});
Deno.test("isValidId - accepts a simple alphanumeric ID", () => {
  assertEquals(isValidId("ws-demo"), true);
});
Deno.test("isValidId - accepts single character ID", () => {
  assertEquals(isValidId("a"), true);
});
Deno.test("isValidId - accepts ID with underscore", () => {
  assertEquals(isValidId("my_workspace_123"), true);
});
Deno.test("isValidId - accepts ID with hyphen", () => {
  assertEquals(isValidId("my-workspace-123"), true);
});
Deno.test("isValidId - rejects empty string", () => {
  assertEquals(isValidId(""), false);
});
Deno.test("isValidId - rejects ID with special characters", () => {
  assertEquals(isValidId("ws!@#$%"), false);
});
Deno.test("isValidId - rejects ID exceeding 64 characters", () => {
  assertEquals(isValidId("a".repeat(65)), false);
});
Deno.test("isValidId - accepts ID at exactly 64 characters", () => {
  assertEquals(isValidId("a".repeat(64)), true);
});
Deno.test("isValidId - rejects non-string input", () => {
  // @ts-expect-error testing runtime behavior with wrong type
  assertEquals(isValidId(123), false);
});
Deno.test("isValidId - respects custom minLength", () => {
  assertEquals(isValidId("ab", 3), false);
  assertEquals(isValidId("abc", 3), true);
});
Deno.test("isValidId - rejects ID with spaces", () => {
  assertEquals(isValidId("has space"), false);
});
Deno.test("isValidId - rejects ID with dots", () => {
  assertEquals(isValidId("has.dot"), false);
});
