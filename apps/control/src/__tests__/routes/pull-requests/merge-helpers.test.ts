import { assertEquals } from "jsr:@std/assert";

import {
  jsonErrorWithStatus,
  validateConflictResolutionPath,
} from "../../../../../../packages/control/src/server/routes/pull-requests/merge.ts";

Deno.test("validateConflictResolutionPath accepts normal repository paths", () => {
  assertEquals(validateConflictResolutionPath("src/main.ts"), "src/main.ts");
  assertEquals(
    validateConflictResolutionPath("docs/specs/merge.md"),
    "docs/specs/merge.md",
  );
});

Deno.test("validateConflictResolutionPath rejects invalid or unsafe paths", () => {
  assertEquals(validateConflictResolutionPath("../secrets.txt"), null);
  assertEquals(validateConflictResolutionPath(""), null);
  assertEquals(validateConflictResolutionPath(null), null);
  assertEquals(validateConflictResolutionPath(42), null);
});

Deno.test("jsonErrorWithStatus returns a JSON response with the requested status", async () => {
  const response = jsonErrorWithStatus({ error: "REF_CONFLICT" }, 409);

  assertEquals(response.status, 409);
  assertEquals(response.headers.get("content-type"), "application/json");
  assertEquals(await response.json(), { error: "REF_CONFLICT" });
});
