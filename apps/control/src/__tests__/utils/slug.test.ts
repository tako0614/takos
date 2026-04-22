import { sanitizeRepoName, slugifyName } from "@/utils";

import { assertEquals } from "jsr:@std/assert";

Deno.test("slugifyName - lowercases and replaces spaces with hyphens", () => {
  assertEquals(slugifyName("My Space Name"), "my-space-name");
});
Deno.test("slugifyName - removes leading and trailing hyphens", () => {
  assertEquals(slugifyName("---hello---"), "hello");
});
Deno.test("slugifyName - replaces consecutive special chars with single hyphen", () => {
  assertEquals(slugifyName("a   b___c"), "a-b-c");
});
Deno.test("slugifyName - truncates to 32 characters", () => {
  const long = "a".repeat(50);
  assertEquals(slugifyName(long).length, 32);
});
Deno.test('slugifyName - returns "space" for empty/whitespace input', () => {
  assertEquals(slugifyName(""), "space");
  assertEquals(slugifyName("   "), "space");
  assertEquals(slugifyName("---"), "space");
});
Deno.test("slugifyName - handles unicode characters by replacing them", () => {
  assertEquals(slugifyName("café"), "caf");
});
Deno.test("slugifyName - preserves numbers", () => {
  assertEquals(slugifyName("Project 123"), "project-123");
});
Deno.test("slugifyName - handles mixed special characters", () => {
  assertEquals(slugifyName("Hello@World! #2024"), "hello-world-2024");
});

Deno.test("sanitizeRepoName - lowercases and trims whitespace", () => {
  assertEquals(sanitizeRepoName("  MyRepo  "), "myrepo");
});
Deno.test("sanitizeRepoName - replaces invalid characters with hyphens", () => {
  assertEquals(sanitizeRepoName("my repo@name"), "my-repo-name");
});
Deno.test("sanitizeRepoName - preserves underscores and hyphens", () => {
  assertEquals(sanitizeRepoName("my_repo-name"), "my_repo-name");
});
Deno.test("sanitizeRepoName - preserves numbers", () => {
  assertEquals(sanitizeRepoName("repo123"), "repo123");
});
Deno.test("sanitizeRepoName - handles all-invalid characters", () => {
  assertEquals(sanitizeRepoName("@@@@"), "----");
});
Deno.test("sanitizeRepoName - handles empty string after trim", () => {
  assertEquals(sanitizeRepoName(""), "");
});
Deno.test("sanitizeRepoName - replaces dots with hyphens", () => {
  assertEquals(sanitizeRepoName("my.repo.name"), "my-repo-name");
});
Deno.test("sanitizeRepoName - handles unicode characters", () => {
  assertEquals(sanitizeRepoName("日本語リポ"), "-----");
});
