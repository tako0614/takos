import { assertEquals, assertMatch } from "jsr:@std/assert";

import {
  jsonErrorWithStatus,
  validateConflictResolutionPath,
} from "@/server/routes/pull-requests/merge.ts";

Deno.test("validateConflictResolutionPath accepts normal repository paths", () => {
  assertEquals(
    validateConflictResolutionPath("src/routes/merge.ts"),
    "src/routes/merge.ts",
  );
  assertEquals(
    validateConflictResolutionPath(" docs/spec.md "),
    "docs/spec.md",
  );
});

Deno.test("validateConflictResolutionPath rejects invalid or dangerous paths", () => {
  assertEquals(validateConflictResolutionPath(null), null);
  assertEquals(validateConflictResolutionPath(""), null);
  assertEquals(validateConflictResolutionPath("../secrets.txt"), null);
  assertEquals(validateConflictResolutionPath("/etc/passwd"), null);
});

Deno.test("jsonErrorWithStatus serializes the given body and status", async () => {
  const response = jsonErrorWithStatus(
    {
      error: "REF_CONFLICT",
      message: "Ref conflict: branch was modified by another process",
      current: "abc123",
    },
    409,
  );

  assertEquals(response.status, 409);
  assertEquals(response.headers.get("Content-Type"), "application/json");
  assertEquals(await response.json(), {
    error: {
      code: "CONFLICT",
      message: "Ref conflict: branch was modified by another process",
      details: {
        current: "abc123",
      },
    },
  });
});

Deno.test("jsonErrorWithStatus returns JSON text", async () => {
  const response = jsonErrorWithStatus({ error: "Branch not found" }, 404);
  const text = await response.text();

  assertMatch(text, /Branch not found/);
  assertMatch(text, /"code":"NOT_FOUND"/);
});
