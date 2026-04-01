import { assertEquals, assertObjectMatch } from "jsr:@std/assert";

async function loadGitHttpModule() {
  if (!Deno.env.get("TAKOS_API_URL")) {
    Deno.env.set("TAKOS_API_URL", "https://takos.dev");
  }
  return await import("../../routes/git/http.ts");
}

Deno.test("normalizeLfsOid lowercases valid SHA-256 object ids", async () => {
  const { normalizeLfsOid } = await loadGitHttpModule();

  assertEquals(normalizeLfsOid("A".repeat(64)), "a".repeat(64));
  assertEquals(normalizeLfsOid("not-a-valid-oid"), null);
  assertEquals(normalizeLfsOid(undefined), null);
});

Deno.test("parseLfsBatchRequest accepts well-formed upload and download payloads", async () => {
  const { parseLfsBatchRequest } = await loadGitHttpModule();
  const oid = "a".repeat(64);

  assertEquals(
    parseLfsBatchRequest({
      operation: "upload",
      objects: [{ oid, size: 12 }],
    }),
    {
      operation: "upload",
      objects: [{ oid, size: 12 }],
    },
  );

  assertEquals(
    parseLfsBatchRequest({
      operation: "download",
      objects: [{ oid, size: 34 }],
    }),
    {
      operation: "download",
      objects: [{ oid, size: 34 }],
    },
  );
});

Deno.test("parseLfsBatchRequest rejects malformed payloads", async () => {
  const { parseLfsBatchRequest } = await loadGitHttpModule();

  assertEquals(parseLfsBatchRequest(null), null);
  assertEquals(parseLfsBatchRequest({ operation: "upload" }), null);
  assertEquals(
    parseLfsBatchRequest({
      operation: "upload",
      objects: [{ oid: "bad", size: 12 }],
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
});

Deno.test("buildLfsBatchObjectResponse preserves upload and missing download behavior", async () => {
  const { buildLfsBatchObjectResponse } = await loadGitHttpModule();
  const oid = "b".repeat(64);
  const href = `https://git.takos.dev/git/ws/repo.git/info/lfs/objects/${oid}`;

  assertObjectMatch(
    buildLfsBatchObjectResponse({
      operation: "upload",
      oid,
      size: 12,
      exists: false,
      href,
    }),
    {
      oid,
      size: 12,
      actions: {
        upload: {
          href,
          expires_in: 3600,
        },
      },
    },
  );

  assertEquals(
    buildLfsBatchObjectResponse({
      operation: "download",
      oid,
      size: 12,
      exists: false,
      href,
    }),
    {
      oid,
      size: 12,
      error: {
        code: 404,
        message: "Object does not exist",
      },
    },
  );
});

Deno.test("parseContentLength accepts numeric headers and rejects invalid values", async () => {
  const { parseContentLength } = await loadGitHttpModule();

  assertEquals(parseContentLength("0"), 0);
  assertEquals(parseContentLength("123"), 123);
  assertEquals(parseContentLength(undefined), null);
  assertEquals(Number.isNaN(parseContentLength("abc")), true);
});
