import { test } from "bun:test";
import { assertEquals } from "@takos/test/assert";
import { expandTakosumiAccountsPatScopes } from "./accounts-bearer.ts";

test("expandTakosumiAccountsPatScopes maps read bucket to read-only API scopes", () => {
  const scopes = expandTakosumiAccountsPatScopes(["read"]);

  assertEquals(scopes.includes("read"), true);
  assertEquals(scopes.includes("profile"), true);
  assertEquals(scopes.includes("threads:read"), true);
  assertEquals(scopes.includes("files:read"), true);
  assertEquals(scopes.includes("threads:write"), false);
  assertEquals(scopes.includes("agents:execute"), false);
});

test("expandTakosumiAccountsPatScopes maps write bucket to read/write API scopes", () => {
  const scopes = expandTakosumiAccountsPatScopes(["write"]);

  assertEquals(scopes.includes("write"), true);
  assertEquals(scopes.includes("threads:read"), true);
  assertEquals(scopes.includes("threads:write"), true);
  assertEquals(scopes.includes("files:write"), true);
  assertEquals(scopes.includes("agents:execute"), false);
});

test("expandTakosumiAccountsPatScopes maps admin bucket to all API scopes", () => {
  const scopes = expandTakosumiAccountsPatScopes(["admin"]);

  assertEquals(scopes.includes("admin"), true);
  assertEquals(scopes.includes("threads:read"), true);
  assertEquals(scopes.includes("threads:write"), true);
  assertEquals(scopes.includes("agents:execute"), true);
  assertEquals(scopes.includes("mcp:invoke"), true);
});
