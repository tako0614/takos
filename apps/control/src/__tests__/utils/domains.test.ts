import {
  generateDomainId,
  generateVerificationToken,
  isValidDomain,
  normalizeDomain,
} from "@/utils/domain-validation";

import { assert, assertEquals, assertNotEquals } from "jsr:@std/assert";

Deno.test("generateVerificationToken - returns a 64-char hex string", () => {
  const token = generateVerificationToken();
  assertEquals(token.length, 64);
  assert(/^[0-9a-f]{64}$/.test(token));
});
Deno.test("generateVerificationToken - generates different tokens each call", () => {
  const t1 = generateVerificationToken();
  const t2 = generateVerificationToken();
  assertNotEquals(t1, t2);
});

Deno.test('generateDomainId - starts with "dom_" prefix', () => {
  const id = generateDomainId();
  assertEquals(id.startsWith("dom_"), true);
});
Deno.test("generateDomainId - has correct total length (4 prefix + 32 hex chars)", () => {
  const id = generateDomainId();
  assertEquals(id.length, 4 + 32);
});
Deno.test("generateDomainId - hex portion is valid hex", () => {
  const id = generateDomainId();
  const hex = id.slice(4);
  assert(/^[0-9a-f]{32}$/.test(hex));
});
Deno.test("generateDomainId - generates unique IDs", () => {
  const id1 = generateDomainId();
  const id2 = generateDomainId();
  assertNotEquals(id1, id2);
});

Deno.test("isValidDomain - accepts a valid two-label domain", () => {
  assertEquals(isValidDomain("example.com"), true);
});
Deno.test("isValidDomain - accepts a valid multi-label domain", () => {
  assertEquals(isValidDomain("sub.example.com"), true);
});
Deno.test("isValidDomain - accepts domains with trailing dot (FQDN)", () => {
  assertEquals(isValidDomain("example.com."), true);
});
Deno.test("isValidDomain - rejects empty string", () => {
  assertEquals(isValidDomain(""), false);
});
Deno.test("isValidDomain - rejects single-label domain (no dots)", () => {
  assertEquals(isValidDomain("localhost"), false);
});
Deno.test("isValidDomain - rejects domain exceeding 253 characters", () => {
  const long = "a".repeat(250) + ".com";
  assertEquals(isValidDomain(long), false);
});
Deno.test("isValidDomain - rejects label exceeding 63 characters", () => {
  const longLabel = "a".repeat(64) + ".com";
  assertEquals(isValidDomain(longLabel), false);
});
Deno.test("isValidDomain - accepts label at exactly 63 characters", () => {
  const maxLabel = "a".repeat(63) + ".com";
  assertEquals(isValidDomain(maxLabel), true);
});
Deno.test("isValidDomain - rejects empty label (consecutive dots)", () => {
  assertEquals(isValidDomain("example..com"), false);
});
Deno.test("isValidDomain - rejects label starting with hyphen", () => {
  assertEquals(isValidDomain("-example.com"), false);
});
Deno.test("isValidDomain - rejects label ending with hyphen", () => {
  assertEquals(isValidDomain("example-.com"), false);
});
Deno.test("isValidDomain - accepts label with hyphens in the middle", () => {
  assertEquals(isValidDomain("my-example.com"), true);
});
Deno.test("isValidDomain - rejects label with underscores", () => {
  assertEquals(isValidDomain("my_example.com"), false);
});
Deno.test("isValidDomain - rejects domain with spaces", () => {
  assertEquals(isValidDomain("my domain.com"), false);
});
Deno.test("isValidDomain - accepts numeric labels", () => {
  assertEquals(isValidDomain("123.456"), true);
});
Deno.test("isValidDomain - accepts mixed case (labels are case-insensitive)", () => {
  assertEquals(isValidDomain("Example.COM"), true);
});

Deno.test("normalizeDomain - lowercases the domain", () => {
  assertEquals(normalizeDomain("EXAMPLE.COM"), "example.com");
});
Deno.test("normalizeDomain - trims whitespace", () => {
  assertEquals(normalizeDomain("  example.com  "), "example.com");
});
Deno.test("normalizeDomain - removes trailing dots", () => {
  assertEquals(normalizeDomain("example.com."), "example.com");
});
Deno.test("normalizeDomain - removes multiple trailing dots", () => {
  assertEquals(normalizeDomain("example.com..."), "example.com");
});
Deno.test("normalizeDomain - handles combined normalization", () => {
  assertEquals(normalizeDomain("  Example.COM.  "), "example.com");
});
