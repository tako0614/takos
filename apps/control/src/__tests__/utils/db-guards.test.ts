import {
  isInvalidArrayBufferError,
  isValidLookupEmail,
  isValidOpaqueId,
} from "@/utils/db-guards";

import { assertEquals } from "jsr:@std/assert";

Deno.test("db guards (issue 183) - detects invalid array buffer errors", () => {
  assertEquals(
    isInvalidArrayBufferError(
      new Error("Invalid array buffer length"),
    ),
    true,
  );
  assertEquals(
    isInvalidArrayBufferError({
      message: "Invalid array buffer length",
    }),
    true,
  );
  assertEquals(isInvalidArrayBufferError("Invalid array buffer length"), true);
  assertEquals(
    isInvalidArrayBufferError(
      new Error(
        "The column `main.threads.summary` does not exist in the current database.",
      ),
    ),
    true,
  );
  assertEquals(isInvalidArrayBufferError(new Error("Some other error")), false);
});
Deno.test("db guards (issue 183) - validates opaque IDs", () => {
  assertEquals(isValidOpaqueId("repo_123-abc"), true);
  assertEquals(isValidOpaqueId(""), false);
  assertEquals(isValidOpaqueId("abc.def"), false);
  assertEquals(isValidOpaqueId("x".repeat(129)), false);
});
Deno.test("db guards (issue 183) - validates lookup emails", () => {
  assertEquals(isValidLookupEmail("user@example.com"), true);
  assertEquals(isValidLookupEmail(" user@example.com "), true);
  assertEquals(isValidLookupEmail("invalid-email"), false);
  assertEquals(isValidLookupEmail("x".repeat(321)), false);
});
