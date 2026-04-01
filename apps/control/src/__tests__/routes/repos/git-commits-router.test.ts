import {
  assertEquals,
  assertThrows,
} from "jsr:@std/assert";

import {
  getCommitParents,
  getCommitSha,
  requireBucket,
  sigTimestampToIso,
} from "../../../../../../packages/control/src/server/routes/repos/git-shared.ts";

Deno.test("sigTimestampToIso normalizes second and millisecond timestamps", () => {
  assertEquals(sigTimestampToIso(1), "1970-01-01T00:00:01.000Z");
  assertEquals(
    sigTimestampToIso(Date.parse("2025-02-15T00:00:01Z")),
    "2025-02-15T00:00:01.000Z",
  );
  assertEquals(
    sigTimestampToIso("2025-02-15T00:00:01Z"),
    "2025-02-15T00:00:01.000Z",
  );
});

Deno.test("getCommitSha prefers sha and falls back to oid", () => {
  assertEquals(getCommitSha({ sha: "sha-1", oid: "oid-1" }), "sha-1");
  assertEquals(getCommitSha({ oid: "oid-1" }), "oid-1");
  assertEquals(getCommitSha({}), "");
});

Deno.test("getCommitParents returns an array or an empty list", () => {
  assertEquals(getCommitParents({ parents: ["p1", "p2"] }), ["p1", "p2"]);
  assertEquals(getCommitParents({}), []);
});

Deno.test("requireBucket throws when GIT_OBJECTS is missing", () => {
  assertThrows(
    () =>
      requireBucket({
        env: {},
      } as never),
    Error,
    "Git storage not configured",
  );
});
