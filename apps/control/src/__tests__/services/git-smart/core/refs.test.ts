import { isValidRefName } from "@/services/git-smart/core/refs";
import { assertEquals } from "jsr:@std/assert";

Deno.test("isValidRefName - accepts valid ref names", () => {
  for (const name of ["main", "feature/branch", "release-1.0", "a"]) {
    assertEquals(isValidRefName(name), true);
  }
});

Deno.test("isValidRefName - rejects invalid ref names", () => {
  const invalid = [
    "",
    "a".repeat(256),
    "foo..bar",
    "foo~bar",
    "foo^bar",
    "foo:bar",
    "foo?bar",
    "foo*bar",
    "foo[bar",
    "foo\\bar",
    "branch.lock",
    "branch.",
    "/branch",
    "branch/",
    "foo//bar",
    "foo@{bar",
    "branch-\u00e9",
    null,
    undefined,
    42,
  ];

  for (const name of invalid) {
    assertEquals(isValidRefName(name), false);
  }
});
