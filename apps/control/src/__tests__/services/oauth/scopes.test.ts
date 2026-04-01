import {
  areScopesAllowed,
  getScopeSummary,
  hasAccess,
  parseScopes,
  validateScopes,
} from "@/services/oauth/scopes";

import { assertEquals } from "jsr:@std/assert";

Deno.test("parseScopes - splits a space-separated scope string", () => {
  assertEquals(parseScopes("openid profile email"), [
    "openid",
    "profile",
    "email",
  ]);
});
Deno.test("parseScopes - handles multiple spaces between scopes", () => {
  assertEquals(parseScopes("openid   profile"), ["openid", "profile"]);
});
Deno.test("parseScopes - trims and filters empty entries", () => {
  assertEquals(parseScopes("  openid  profile  "), ["openid", "profile"]);
});
Deno.test("parseScopes - returns empty array for empty string", () => {
  assertEquals(parseScopes(""), []);
});
Deno.test("parseScopes - returns empty array for whitespace-only string", () => {
  assertEquals(parseScopes("   "), []);
});
Deno.test("parseScopes - handles single scope", () => {
  assertEquals(parseScopes("openid"), ["openid"]);
});
Deno.test("parseScopes - handles tab-separated scopes", () => {
  assertEquals(parseScopes("openid\tprofile"), ["openid", "profile"]);
});

Deno.test("validateScopes - returns valid for known scopes", () => {
  const result = validateScopes(["openid", "profile", "email"]);
  assertEquals(result.valid, true);
  assertEquals(result.unknown, []);
});
Deno.test("validateScopes - returns invalid with unknown scopes listed", () => {
  const result = validateScopes(["openid", "fake_scope", "another_bad"]);
  assertEquals(result.valid, false);
  assertEquals(result.unknown, ["fake_scope", "another_bad"]);
});
Deno.test("validateScopes - returns valid for empty scopes array", () => {
  const result = validateScopes([]);
  assertEquals(result.valid, true);
  assertEquals(result.unknown, []);
});
Deno.test("validateScopes - recognizes all resource scopes", () => {
  const resourceScopes = [
    "spaces:read",
    "spaces:write",
    "files:read",
    "files:write",
    "memories:read",
    "memories:write",
    "threads:read",
    "threads:write",
    "agents:execute",
    "repos:read",
    "repos:write",
  ];

  const result = validateScopes(resourceScopes);
  assertEquals(result.valid, true);
  assertEquals(result.unknown, []);
});

Deno.test("areScopesAllowed - returns true when all requested scopes are in allowed list", () => {
  assertEquals(
    areScopesAllowed(["openid", "profile"], ["openid", "profile", "email"]),
    true,
  );
});
Deno.test("areScopesAllowed - returns true for empty requested scopes", () => {
  assertEquals(areScopesAllowed([], ["openid"]), true);
});
Deno.test("areScopesAllowed - returns false when a requested scope is not allowed", () => {
  assertEquals(
    areScopesAllowed(["openid", "spaces:write"], ["openid", "profile"]),
    false,
  );
});
Deno.test("areScopesAllowed - returns false when allowed list is empty", () => {
  assertEquals(areScopesAllowed(["openid"], []), false);
});

Deno.test("hasAccess - returns true for exact scope match", () => {
  assertEquals(hasAccess(["spaces:read"], "spaces", "read"), true);
  assertEquals(hasAccess(["files:write"], "files", "write"), true);
  assertEquals(hasAccess(["agents:execute"], "agents", "execute"), true);
});
Deno.test("hasAccess - returns false when scope is not granted", () => {
  assertEquals(hasAccess(["spaces:read"], "files", "read"), false);
  assertEquals(hasAccess([], "spaces", "read"), false);
});
Deno.test("hasAccess - write scope implies read access", () => {
  assertEquals(hasAccess(["spaces:write"], "spaces", "read"), true);
  assertEquals(hasAccess(["files:write"], "files", "read"), true);
});
Deno.test("hasAccess - read scope does not imply write access", () => {
  assertEquals(hasAccess(["spaces:read"], "spaces", "write"), false);
});
Deno.test("hasAccess - write scope does not imply execute access", () => {
  assertEquals(hasAccess(["agents:write"], "agents", "execute"), false);
});
Deno.test("hasAccess - execute scope does not imply read or write", () => {
  assertEquals(hasAccess(["agents:execute"], "agents", "read"), false);
  assertEquals(hasAccess(["agents:execute"], "agents", "write"), false);
});

Deno.test("getScopeSummary - separates identity and resource scopes", () => {
  const summary = getScopeSummary([
    "openid",
    "profile",
    "spaces:read",
    "files:write",
  ]);
  assertEquals(summary.identity.includes("OpenID Connect identity"), true);
  assertEquals(summary.identity.includes("User profile (name, picture)"), true);
  assertEquals(summary.resources.includes("Read workspaces"), true);
  assertEquals(summary.resources.includes("Write files"), true);
});
Deno.test("getScopeSummary - returns empty arrays for empty scopes", () => {
  const summary = getScopeSummary([]);
  assertEquals(summary.identity, []);
  assertEquals(summary.resources, []);
});
Deno.test("getScopeSummary - ignores unknown scopes", () => {
  const summary = getScopeSummary(["unknown_scope"]);
  assertEquals(summary.identity, []);
  assertEquals(summary.resources, []);
});
