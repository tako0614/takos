import { assertRejects } from "jsr:@std/assert";

import { buildPRDiffText } from "@/application/services/pull-requests/ai-review.ts";

Deno.test("buildPRDiffText rejects when git storage is not configured", async () => {
  await assertRejects(
    () =>
      buildPRDiffText(
        {
          DB: {} as never,
          GIT_OBJECTS: undefined,
        } as never,
        "repo-1",
        "main",
        "feature/pr",
      ),
    Error,
    "Git storage not configured",
  );
});
