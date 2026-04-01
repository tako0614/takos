import { assertEquals } from "jsr:@std/assert";

import {
  getCommitParents,
  getCommitSha,
  sigTimestampToIso,
} from "../../../../../../packages/control/src/server/routes/repos/git-shared.ts";

Deno.test("sigTimestampToIso normalizes seconds, milliseconds, and ISO strings", () => {
  assertEquals(sigTimestampToIso(1_706_000_000), "2024-01-23T08:53:20.000Z");
  assertEquals(
    sigTimestampToIso(1_706_000_000_000),
    "2024-01-23T08:53:20.000Z",
  );
  assertEquals(
    sigTimestampToIso("2026-02-15T00:00:03Z"),
    "2026-02-15T00:00:03.000Z",
  );
});

Deno.test("sigTimestampToIso falls back to the epoch when timestamp is missing", () => {
  assertEquals(sigTimestampToIso(undefined), "1970-01-01T00:00:00.000Z");
});

Deno.test("getCommitSha prefers sha and falls back to oid", () => {
  assertEquals(
    getCommitSha({ sha: "commit-sha", oid: "commit-oid" }),
    "commit-sha",
  );
  assertEquals(getCommitSha({ oid: "commit-oid" }), "commit-oid");
  assertEquals(getCommitSha({}), "");
});

Deno.test("getCommitParents returns a normalized parent array", () => {
  assertEquals(getCommitParents({ parents: ["p1", "p2"] }), ["p1", "p2"]);
  assertEquals(getCommitParents({ parents: undefined }), []);
});
