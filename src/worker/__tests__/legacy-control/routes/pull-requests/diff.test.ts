import { assertEquals } from "@std/assert";

import { buildDetailedRepoDiffPayload } from "@/server/routes/pull-requests/diff.ts";
import type { Env } from "@/types";

Deno.test("buildDetailedRepoDiffPayload returns common error envelope when git storage is missing", async () => {
  // Only GIT_OBJECTS matters for this test; the function only reads that one field.
  const env: Partial<Env> = { GIT_OBJECTS: undefined };
  const result = await buildDetailedRepoDiffPayload(
    env as Env,
    "repo-1",
    "main",
    "feature",
  );

  assertEquals(result, {
    success: false,
    status: 500,
    body: {
      error: {
        code: "INTERNAL_ERROR",
        message: "Git storage not configured",
      },
    },
  });
});
