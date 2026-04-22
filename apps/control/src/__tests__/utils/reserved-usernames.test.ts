import {
  isReservedUsername,
  RESERVED_USERNAMES,
  validateUsername,
} from "@/utils/domain-validation";

import { assert, assertEquals } from "jsr:@std/assert";

Deno.test("RESERVED_USERNAMES - is a non-empty Set", () => {
  assert(RESERVED_USERNAMES instanceof Set);
  assert(RESERVED_USERNAMES.size > 0);
});
Deno.test("RESERVED_USERNAMES - contains system accounts", () => {
  assertEquals(RESERVED_USERNAMES.has("admin"), true);
  assertEquals(RESERVED_USERNAMES.has("root"), true);
  assertEquals(RESERVED_USERNAMES.has("system"), true);
});
Deno.test("RESERVED_USERNAMES - contains platform branding", () => {
  assertEquals(RESERVED_USERNAMES.has("yurucommu"), true);
});
Deno.test("RESERVED_USERNAMES - contains route-conflicting names", () => {
  assertEquals(RESERVED_USERNAMES.has("login"), true);
  assertEquals(RESERVED_USERNAMES.has("settings"), true);
  assertEquals(RESERVED_USERNAMES.has("api"), true);
});

Deno.test("isReservedUsername - returns true for reserved name (lowercase)", () => {
  assertEquals(isReservedUsername("admin"), true);
});
Deno.test("isReservedUsername - is case-insensitive", () => {
  assertEquals(isReservedUsername("Admin"), true);
  assertEquals(isReservedUsername("ADMIN"), true);
  assertEquals(isReservedUsername("AdMiN"), true);
});
Deno.test("isReservedUsername - returns false for non-reserved name", () => {
  assertEquals(isReservedUsername("johndoe"), false);
});
Deno.test("isReservedUsername - returns false for empty string", () => {
  assertEquals(isReservedUsername(""), false);
});

Deno.test("validateUsername - returns null for a valid username", () => {
  assertEquals(validateUsername("johndoe"), null);
});
Deno.test("validateUsername - accepts usernames with numbers", () => {
  assertEquals(validateUsername("user123"), null);
});
Deno.test("validateUsername - accepts usernames with underscores", () => {
  assertEquals(validateUsername("john_doe"), null);
});
Deno.test("validateUsername - accepts usernames with hyphens", () => {
  assertEquals(validateUsername("john-doe"), null);
});
Deno.test("validateUsername - accepts minimum length (3 chars)", () => {
  assertEquals(validateUsername("abc"), null);
});
Deno.test("validateUsername - accepts maximum length (30 chars)", () => {
  assertEquals(validateUsername("a".repeat(30)), null);
});
Deno.test("validateUsername - rejects empty string", () => {
  assertEquals(validateUsername(""), "Username is required");
});
Deno.test("validateUsername - rejects too short (2 chars)", () => {
  assertEquals(
    validateUsername("ab"),
    "Username must be at least 3 characters",
  );
});
Deno.test("validateUsername - rejects too long (31 chars)", () => {
  assertEquals(
    validateUsername("a".repeat(31)),
    "Username must be at most 30 characters",
  );
});
Deno.test("validateUsername - rejects invalid characters", () => {
  assertEquals(
    validateUsername("user@name"),
    "Username can only contain letters, numbers, underscores, and hyphens",
  );
});
Deno.test("validateUsername - rejects spaces", () => {
  assertEquals(
    validateUsername("user name"),
    "Username can only contain letters, numbers, underscores, and hyphens",
  );
});
Deno.test("validateUsername - rejects dots", () => {
  assertEquals(
    validateUsername("user.name"),
    "Username can only contain letters, numbers, underscores, and hyphens",
  );
});
Deno.test("validateUsername - rejects starting with underscore", () => {
  assertEquals(
    validateUsername("_username"),
    "Username must start with a letter or number",
  );
});
Deno.test("validateUsername - rejects starting with hyphen", () => {
  assertEquals(
    validateUsername("-username"),
    "Username must start with a letter or number",
  );
});
Deno.test("validateUsername - rejects ending with underscore", () => {
  assertEquals(
    validateUsername("username_"),
    "Username cannot end with underscore or hyphen",
  );
});
Deno.test("validateUsername - rejects ending with hyphen", () => {
  assertEquals(
    validateUsername("username-"),
    "Username cannot end with underscore or hyphen",
  );
});
Deno.test("validateUsername - rejects consecutive underscores", () => {
  assertEquals(
    validateUsername("user__name"),
    "Username cannot have consecutive underscores or hyphens",
  );
});
Deno.test("validateUsername - rejects consecutive hyphens", () => {
  assertEquals(
    validateUsername("user--name"),
    "Username cannot have consecutive underscores or hyphens",
  );
});
Deno.test("validateUsername - rejects mixed consecutive separators", () => {
  assertEquals(
    validateUsername("user-_name"),
    "Username cannot have consecutive underscores or hyphens",
  );
});
Deno.test("validateUsername - rejects reserved usernames", () => {
  assertEquals(validateUsername("admin"), "This username is reserved");
  assertEquals(validateUsername("root"), "This username is reserved");
});
Deno.test("validateUsername - rejects reserved usernames case-insensitively", () => {
  assertEquals(validateUsername("Admin"), "This username is reserved");
});
