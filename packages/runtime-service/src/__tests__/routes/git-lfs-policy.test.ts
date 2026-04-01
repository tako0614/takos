import {
  buildLfsBatchObjectResponse,
  getLfsObjectPath,
  normalizeLfsOid,
  parseContentLength,
  parseLfsBatchRequest,
} from "../../routes/git/http.ts";

import { assertEquals } from "jsr:@std/assert";

Deno.test("git-lfs policy helpers", () => {
  const upper = "A".repeat(64);
  assertEquals(normalizeLfsOid(upper), "a".repeat(64));
  assertEquals(normalizeLfsOid("invalid"), null);
  assertEquals(normalizeLfsOid(undefined), null);

  assertEquals(
    parseLfsBatchRequest({
      operation: "upload",
      objects: [{ oid: upper, size: 42 }],
    }),
    {
      operation: "upload",
      objects: [{ oid: "a".repeat(64), size: 42 }],
    },
  );

  assertEquals(
    parseLfsBatchRequest({
      operation: "upload",
      objects: [{ oid: "abc", size: 1 }],
    }),
    null,
  );
  assertEquals(
    parseLfsBatchRequest({
      operation: "download",
      objects: [{ oid: "a".repeat(64), size: -1 }],
    }),
    null,
  );
  assertEquals(parseLfsBatchRequest({ operation: "download" }), null);
  assertEquals(parseLfsBatchRequest(null), null);

  assertEquals(parseContentLength(undefined), null);
  assertEquals(parseContentLength(""), null);
  assertEquals(parseContentLength("123"), 123);
  assertEquals(Number.isNaN(parseContentLength("12x")), true);

  const oid = "ab".padEnd(64, "c");
  assertEquals(
    getLfsObjectPath("/repo.git", oid),
    "/repo.git/lfs/objects/ab/cc/".concat(oid),
  );

  const href = `https://example.test/git/ws/repo.git/info/lfs/objects/${
    "a".repeat(64)
  }`;
  assertEquals(
    buildLfsBatchObjectResponse({
      operation: "upload",
      oid: "a".repeat(64),
      size: 12,
      exists: true,
      href,
    }),
    { oid: "a".repeat(64), size: 12 },
  );
  assertEquals(
    buildLfsBatchObjectResponse({
      operation: "upload",
      oid: "a".repeat(64),
      size: 12,
      exists: false,
      href,
    }),
    {
      oid: "a".repeat(64),
      size: 12,
      actions: { upload: { href, expires_in: 3600 } },
    },
  );
  assertEquals(
    buildLfsBatchObjectResponse({
      operation: "download",
      oid: "a".repeat(64),
      size: 12,
      exists: false,
      href,
    }),
    {
      oid: "a".repeat(64),
      size: 12,
      error: { code: 404, message: "Object does not exist" },
    },
  );
  assertEquals(
    buildLfsBatchObjectResponse({
      operation: "download",
      oid: "a".repeat(64),
      size: 12,
      exists: true,
      href,
    }),
    {
      oid: "a".repeat(64),
      size: 12,
      actions: { download: { href, expires_in: 3600 } },
    },
  );
});
