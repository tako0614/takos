import {
  hasReservedSubdomain,
  isDomainReserved,
  isReservedSubdomain,
  RESERVED_SUBDOMAINS,
} from "@/utils/domain-validation";

import { assert, assertEquals } from "jsr:@std/assert";

Deno.test("RESERVED_SUBDOMAINS - is a non-empty Set", () => {
  assert(RESERVED_SUBDOMAINS instanceof Set);
  assert(RESERVED_SUBDOMAINS.size > 0);
});
Deno.test("RESERVED_SUBDOMAINS - contains admin subdomains", () => {
  assertEquals(RESERVED_SUBDOMAINS.has("admin"), true);
  assertEquals(RESERVED_SUBDOMAINS.has("root"), true);
});
Deno.test("RESERVED_SUBDOMAINS - contains API subdomains", () => {
  assertEquals(RESERVED_SUBDOMAINS.has("api"), true);
  assertEquals(RESERVED_SUBDOMAINS.has("graphql"), true);
});
Deno.test("RESERVED_SUBDOMAINS - contains web subdomains", () => {
  assertEquals(RESERVED_SUBDOMAINS.has("www"), true);
  assertEquals(RESERVED_SUBDOMAINS.has("www1"), true);
});
Deno.test("RESERVED_SUBDOMAINS - contains brand protection", () => {
  assertEquals(RESERVED_SUBDOMAINS.has("takos"), true);
  assertEquals(RESERVED_SUBDOMAINS.has("yurucommu"), true);
});
Deno.test("RESERVED_SUBDOMAINS - contains infrastructure subdomains", () => {
  assertEquals(RESERVED_SUBDOMAINS.has("cdn"), true);
  assertEquals(RESERVED_SUBDOMAINS.has("static"), true);
  assertEquals(RESERVED_SUBDOMAINS.has("mail"), true);
});

Deno.test("isReservedSubdomain - returns true for reserved subdomain", () => {
  assertEquals(isReservedSubdomain("admin"), true);
});
Deno.test("isReservedSubdomain - is case-insensitive", () => {
  assertEquals(isReservedSubdomain("Admin"), true);
  assertEquals(isReservedSubdomain("ADMIN"), true);
});
Deno.test("isReservedSubdomain - returns false for non-reserved subdomain", () => {
  assertEquals(isReservedSubdomain("mycompany"), false);
});
Deno.test("isReservedSubdomain - returns false for empty string", () => {
  assertEquals(isReservedSubdomain(""), false);
});

Deno.test("hasReservedSubdomain - returns true when first label is reserved", () => {
  assertEquals(hasReservedSubdomain("admin.example.com"), true);
});
Deno.test("hasReservedSubdomain - returns false when first label is not reserved", () => {
  assertEquals(hasReservedSubdomain("mysite.example.com"), false);
});
Deno.test("hasReservedSubdomain - only checks the first label", () => {
  assertEquals(hasReservedSubdomain("mysite.admin.com"), false);
});
Deno.test("hasReservedSubdomain - is case-insensitive", () => {
  assertEquals(hasReservedSubdomain("API.example.com"), true);
});
Deno.test("hasReservedSubdomain - handles single-label domain", () => {
  // First label of "admin" is "admin" itself
  assertEquals(hasReservedSubdomain("admin"), true);
});

const baseDomain = "takos.jp";

Deno.test("isDomainReserved - returns true for the platform domain itself", () => {
  assertEquals(isDomainReserved("takos.jp", baseDomain), true);
});
Deno.test("isDomainReserved - returns true for subdomains of platform domain", () => {
  assertEquals(isDomainReserved("anything.takos.jp", baseDomain), true);
  assertEquals(isDomainReserved("sub.anything.takos.jp", baseDomain), true);
});
Deno.test("isDomainReserved - returns true for domains with reserved first label", () => {
  assertEquals(isDomainReserved("admin.example.com", baseDomain), true);
  assertEquals(isDomainReserved("api.example.com", baseDomain), true);
});
Deno.test("isDomainReserved - returns false for non-reserved external domains", () => {
  assertEquals(isDomainReserved("mysite.example.com", baseDomain), false);
});
Deno.test("isDomainReserved - handles case-insensitive comparison", () => {
  assertEquals(isDomainReserved("TAKOS.JP", baseDomain), true);
  assertEquals(isDomainReserved("Admin.Example.COM", baseDomain), true);
});
Deno.test("isDomainReserved - handles trailing dots", () => {
  assertEquals(isDomainReserved("takos.jp.", baseDomain), true);
});
Deno.test("isDomainReserved - handles whitespace", () => {
  assertEquals(isDomainReserved("  takos.jp  ", baseDomain), true);
});
Deno.test("isDomainReserved - returns false for domains that merely contain the base domain string", () => {
  // "not-takos.jp" should not match as a subdomain of "takos.jp"
  assertEquals(isDomainReserved("not-takos.jp", baseDomain), false);
});
