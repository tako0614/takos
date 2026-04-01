import { assertEquals } from "jsr:@std/assert";

import {
  getCommitLog,
  getCommitsFromRef,
  isAncestor,
} from "../../../../../../../packages/control/src/application/services/git-smart/core/commit-index.ts";

Deno.test("getCommitLog returns an empty list when the start SHA is missing", async () => {
  const result = await getCommitLog(
    {} as never,
    {} as never,
    "repo-1",
    "",
    50,
  );

  assertEquals(result, []);
});

Deno.test("getCommitsFromRef returns an empty list when limit is zero", async () => {
  const result = await getCommitsFromRef(
    {} as never,
    {} as never,
    "repo-1",
    "sha-1",
    0,
  );

  assertEquals(result, []);
});

Deno.test("isAncestor returns true when both SHAs are identical", async () => {
  const result = await isAncestor(
    {} as never,
    {} as never,
    "repo-1",
    "same-sha",
    "same-sha",
  );

  assertEquals(result, true);
});
